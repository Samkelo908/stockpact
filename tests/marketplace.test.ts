import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Actor, Order } from '../src/shared/marketplace';
import { actorOrder } from '../src/server/access';
import { getDb, mutate, record, tables, update } from '../src/server/db';
import * as orders from '../src/server/orders';
import * as procurement from '../src/server/procurement';
import { dateIn, demoAccounts, ensureDemoSeed } from '../src/server/seed';
import { marketplaceState } from '../src/server/state';

let directory: string;
const actor = (role: keyof typeof demoAccounts): Actor => ({ ...demoAccounts[role], memberships: [] });
const buyer = actor('buyer');
const supplier = actor('supplier');
const supplier2 = actor('supplier2');
const driver = actor('driver');
const reviewer = actor('admin');
const draft = { product: '500 ml still water', quantity: 20, unit: 'cases', location: 'Woodstock, Cape Town', requiredDate: dateIn(5),
  budgetCents: 450_000, notes: '', category: 'Beverages', substitutions: false, packSize: 24, mode: 'manual' } as const;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stockpact-db-test-'));
  process.env.STOCKPACT_DB_PATH = join(directory, 'pg');
  process.env.STOCKPACT_DEMO = 'true';
  process.env.STOCKPACT_ESCROW_MODE = 'demo';
  delete process.env.DATABASE_URL;
  await ensureDemoSeed();
});

after(async () => {
  if (!directory) return;
  await (await getDb()).destroy();
  await rm(directory, { recursive: true, force: true });
});

test('procurement persists matching, private budgets, quote revisions, and inventory reservations', async () => {
  const request = await mutate((db) => procurement.createRequest(db, buyer, { draft }));
  await assert.rejects(mutate((db) => procurement.enqueueMatch(db, supplier2, request.id)), /Request was not found/);
  await mutate((db) => procurement.enqueueMatch(db, buyer, request.id));
  assert.equal(await procurement.runMatchingJobs(), 1);
  assert.equal(await procurement.runMatchingJobs(), 0);
  const matched = (await marketplaceState(buyer)).requests.find(({ id }) => id === request.id);
  assert.equal(matched?.matches.length, 2);
  await mutate((db) => procurement.sendRequest(db, buyer, { requestId: request.id, supplierIds: [supplier.companyId, supplier2.companyId] }));
  const supplierView = (await marketplaceState(supplier)).requests.find(({ id }) => id === request.id);
  assert.equal(supplierView?.draft.budgetCents, null);
  assert.deepEqual(supplierView?.supplierIds, [supplier.companyId]);

  const terms = { requestId: request.id, quantity: 20, unitPriceCents: 9_500, deliveryFeeCents: 10_000, taxCents: 1,
    deliveryDate: dateIn(2), notes: '24 bottles per case' };
  const firstQuote = await mutate((db) => procurement.submitQuote(db, supplier, terms));
  const latestQuote = await mutate((db) => procurement.submitQuote(db, supplier, { ...terms, unitPriceCents: 9_450 }));
  const alternative = await mutate((db) => procurement.submitQuote(db, supplier2, { ...terms, unitPriceCents: 9_250 }));
  await assert.rejects(mutate((db) => procurement.acceptQuote(db, buyer, firstQuote.id)), /no longer available/);
  await assert.rejects(mutate((db) => procurement.acceptQuote(db, supplier2, latestQuote.id)), /Quote was not found/);
  const accepted = await mutate((db) => procurement.acceptQuote(db, buyer, latestQuote.id));
  assert.equal(accepted.totalCents, 199_001);
  assert.equal((await mutate((db) => procurement.acceptQuote(db, buyer, latestQuote.id))).id, accepted.id);
  await assert.rejects(mutate((db) => procurement.acceptQuote(db, buyer, alternative.id)), /no longer available/);
  const marketplace = await marketplaceState(buyer);
  assert.equal(marketplace.listings.find(({ id }) => id === latestQuote.listingId)?.available, 90);
  assert.equal(marketplace.quotes.find(({ id }) => id === latestQuote.id)?.status, 'accepted');
});

test('handover checks participants and expiry, settles only once, and recovers an interruption', async () => {
  const pending = (await marketplaceState(buyer)).orders.find(({ status }) => status === 'awaiting_funding');
  assert.ok(pending);
  await assert.rejects(mutate((db) => orders.fundOrder(db, supplier, { orderId: pending.id })), /buyer company/);
  await mutate((db) => orders.fundOrder(db, buyer, { orderId: pending.id }));
  await mutate((db) => orders.dispatchOrder(db, supplier, pending.id));
  await assert.rejects(mutate((db) => orders.reviewOrder(db, buyer, { orderId: pending.id, rating: 5, comment: 'Excellent service.' })), /completed purchases/);
  const expired = await mutate((db) => orders.authorizeDelivery(db, buyer, { orderId: pending.id, quantity: 12 }));
  await assert.rejects(mutate((db) => orders.inspectDelivery(db, supplier2, { token: expired.token })), /Order was not found/);
  await assert.rejects(mutate((db) => orders.inspectDelivery(db, driver, { token: expired.token })), /Order was not found/);
  await mutate(async (db) => {
    const id = createHash('sha256').update(expired.token).digest('hex');
    const saved = await record<{ expiresAt: string }>(db, tables.qr, id);
    await update(db, tables.qr, id, { ...saved, expiresAt: '2000-01-01T00:00:00Z' });
  });
  await assert.rejects(mutate((db) => orders.redeemDelivery(db, supplier, { token: expired.token })), /expired/);

  const qr = await mutate((db) => orders.authorizeDelivery(db, buyer, { orderId: pending.id, quantity: 12 }));
  assert.equal(qr.amountCents, 119_400);
  await mutate((db) => orders.assignDriver(db, supplier, { orderId: pending.id, driverId: driver.id }));
  const interrupted = await mutate((db) => orders.redeemDelivery(db, driver, { token: qr.token, simulateInterruption: true }));
  assert.ok('paymentStatus' in interrupted && interrupted.paymentStatus === 409);
  const waiting = await actorOrder(await getDb(), buyer, pending.id);
  assert.equal(waiting.releasedCents, 0);
  assert.equal(waiting.transactions.find((tx) => tx.kind === 'release')?.status, 'pending');
  const attempts = await Promise.allSettled([
    mutate((db) => orders.redeemDelivery(db, driver, { token: qr.token })),
    mutate((db) => orders.redeemDelivery(db, supplier, { token: qr.token })),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  const duplicate = attempts.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  assert.match(String(duplicate?.reason), /already been used/);
  await assert.rejects(mutate((db) => orders.authorizeDelivery(db, buyer, { orderId: pending.id, quantity: 9 })), /outstanding quantity/);

  const final = await mutate((db) => orders.authorizeDelivery(db, buyer, { orderId: pending.id, quantity: 8 }));
  assert.equal(final.amountCents, 79_601);
  const completed = await mutate((db) => orders.redeemDelivery(db, supplier, { token: final.token })) as Order;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.releasedCents, completed.fundedCents);
  assert.equal(completed.acceptedQuantity, 20);
  await assert.rejects(mutate((db) => orders.reviewOrder(db, supplier, { orderId: pending.id, rating: 5, comment: 'Wrong party.' })), /buyer company/);
  await mutate((db) => orders.reviewOrder(db, buyer, { orderId: pending.id, rating: 5, comment: 'Arrived as agreed.' }));
  await assert.rejects(mutate((db) => orders.reviewOrder(db, buyer, { orderId: pending.id, rating: 5, comment: 'Duplicate review.' })), /one buyer review/);
  const reordered = await mutate((db) => orders.reorder(db, buyer, pending.id));
  assert.equal(reordered.quantity, 20);
  assert.equal(reordered.budgetCents, null);
});

test('dispute refunds require a reviewer and preserve the recorded amount', async () => {
  await assert.rejects(mutate((db) => orders.resolveDispute(db, buyer, { disputeId: 'demo-dispute', resolution: 'Refund damaged cases.', refund: true })), /cannot perform/);
  const order = await mutate((db) => orders.resolveDispute(db, reviewer, { disputeId: 'demo-dispute', resolution: 'Refund damaged cases.', refund: true }));
  assert.equal(order.status, 'cancelled');
  assert.equal(order.refundedCents, order.fundedCents);
  assert.equal(order.releasedCents, 0);
  assert.equal((await marketplaceState(buyer)).disputes.find(({ id }) => id === 'demo-dispute')?.status, 'resolved');
});
