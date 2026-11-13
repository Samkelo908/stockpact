import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Actor, Order, RequestDraft } from '../src/shared/marketplace';
import { getDb, mutate } from '../src/server/db';
import { authorizeDelivery, dispatchOrder, fundOrder, redeemDelivery } from '../src/server/orders';
import { acceptQuote, createMultiRequest, runMatchingJobs, sendRequest, submitQuote } from '../src/server/procurement';
import { dateIn, demoAccounts, ensureDemoSeed } from '../src/server/seed';
import { marketplaceState } from '../src/server/state';

const actor = (role: keyof typeof demoAccounts): Actor => ({ ...demoAccounts[role], memberships: [] });

test('linked purchase lines are atomically created, privately grouped, and settled independently', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stockpact-multi-purchase-'));
  const env = { DATABASE_URL: '', STOCKPACT_DB_PATH: join(root, 'db'), STOCKPACT_DEMO: 'true', STOCKPACT_ESCROW_MODE: 'demo' };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    await (await getDb()).destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  await ensureDemoSeed();
  const buyer = actor('buyer');
  const supplier = actor('supplier');
  const groupId = randomUUID();
  const first: RequestDraft = { product: '500 ml still water', unit: 'cases', packSize: 24, quantity: 4, category: 'Beverages',
    location: 'Cape Town', requiredDate: dateIn(5), budgetCents: 100000, notes: '', substitutions: false, mode: 'manual' };
  const second: RequestDraft = { ...first, product: 'Chopped tomatoes', packSize: 12, quantity: 6, category: 'Food & produce' };
  const input = { groupId, label: 'Confidential shop order', drafts: [first, second] };
  await assert.rejects(mutate((db) => createMultiRequest(db, buyer, { ...input, drafts: [first, { ...second, requiredDate: dateIn(-1) }] })), /Every product/);
  assert.equal((await marketplaceState(buyer)).requests.some((request) => request.group?.id === groupId), false);

  const batch = await mutate((db) => createMultiRequest(db, buyer, input));
  assert.deepEqual(batch.requests.map((request) => request.group?.lineNumber), [1, 2]);
  assert.ok(batch.requests.every((request) => request.status === 'matching' && request.group?.lineCount === 2));
  assert.deepEqual((await mutate((db) => createMultiRequest(db, buyer, input))).requests.map(({ id }) => id), batch.requests.map(({ id }) => id));
  await assert.rejects(mutate((db) => createMultiRequest(db, buyer, { ...input, drafts: [first, { ...second, quantity: 7 }] })), /different details/);
  assert.equal(await runMatchingJobs(buyer.companyId), 2);
  assert.equal(await runMatchingJobs(buyer.companyId), 0);

  const requestIds = batch.requests.map(({ id }) => id);
  const matched = (await marketplaceState(buyer)).requests.filter((request) => requestIds.includes(request.id));
  assert.ok(matched.every((request) => request.matches.length === 2));
  assert.equal((await marketplaceState(supplier)).requests.some((request) => requestIds.includes(request.id)), false);
  for (const requestId of requestIds) {
    await mutate((db) => sendRequest(db, buyer, { requestId, supplierIds: [supplier.companyId] }));
  }
  const offered = (await marketplaceState(supplier)).requests.filter((request) => requestIds.includes(request.id));
  assert.equal(offered.length, 2);
  assert.ok(offered.every((request) => !request.group && request.draft.budgetCents === null));

  const orders: Order[] = [];
  for (const request of batch.requests) {
    const quote = await mutate((db) => submitQuote(db, supplier, { requestId: request.id, quantity: request.draft.quantity,
      unitPriceCents: 15000, deliveryFeeCents: 1000, deliveryDate: dateIn(2), notes: '' }));
    orders.push(await mutate((db) => acceptQuote(db, buyer, quote.id)));
  }
  assert.deepEqual(orders.map(({ quantity }) => quantity), [4, 6]);
  assert.deepEqual(orders.map(({ packSize }) => packSize), [24, 12]);
  assert.notEqual(orders[0].id, orders[1].id);
  const inventory = (await marketplaceState(supplier)).listings;
  assert.equal(inventory.find(({ id }) => id === 'demo-water-a')?.available, 106);
  assert.equal(inventory.find(({ id }) => id === 'demo-tomatoes-a')?.available, 114);

  await mutate((db) => fundOrder(db, buyer, { orderId: orders[0].id }));
  await mutate((db) => dispatchOrder(db, supplier, orders[0].id));
  const qr = await mutate((db) => authorizeDelivery(db, buyer, { orderId: orders[0].id, quantity: 2 }));
  await mutate((db) => redeemDelivery(db, supplier, { token: qr.token }));
  const state = await marketplaceState(buyer);
  assert.equal(state.orders.find(({ id }) => id === orders[0].id)?.acceptedQuantity, 2);
  assert.equal(state.orders.find(({ id }) => id === orders[0].id)?.releasedCents, 30500);
  assert.equal(state.orders.find(({ id }) => id === orders[1].id)?.status, 'awaiting_funding');
  assert.equal(state.orders.find(({ id }) => id === orders[1].id)?.acceptedQuantity, 0);
});
