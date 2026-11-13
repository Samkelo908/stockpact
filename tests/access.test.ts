import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { sql } from 'kysely';
import type { Actor, Company, DemoRole } from '../src/shared/marketplace';
import { actorOrder, supplierAccess } from '../src/server/access';
import { getDb, mutate, record, tables, update } from '../src/server/db';
import { assignDriver, authorizeDelivery, dispatchOrder, fundOrder, inspectDelivery, reviewOrder } from '../src/server/orders';
import { acceptQuote } from '../src/server/procurement';
import { moderateReview, replyReview } from '../src/server/reputation';
import { demoAccounts, ensureDemoSeed } from '../src/server/seed';
import { marketplaceState } from '../src/server/state';

const temporaryRoot = resolve(tmpdir());
let directory: string | undefined;
const actor = (role: DemoRole): Actor => ({ ...demoAccounts[role], memberships: [] });

before(async () => {
  directory = await mkdtemp(join(temporaryRoot, 'stockpact-access-test-'));
  process.env.STOCKPACT_DB_PATH = join(directory, 'pg');
  process.env.STOCKPACT_DEMO = 'true';
  process.env.STOCKPACT_ESCROW_MODE = 'demo';
  delete process.env.DATABASE_URL;
  await ensureDemoSeed();
});

after(async () => {
  if (!directory) return;
  await (await getDb()).destroy();
  assert.equal(dirname(resolve(directory)), temporaryRoot);
  await rm(directory, { recursive: true, force: true });
});

test('an assigned driver can access a handover only through the supplying company', async () => {
  const buyer = actor('buyer');
  const supplier = actor('supplier');
  const otherSupplier = actor('supplier2');
  const driver = actor('driver');
  const order = await mutate((db) => acceptQuote(db, buyer, 'demo-quote-1'));
  await mutate(async (db) => {
    await sql`insert into memberships (id, company_id, user_id, role)
      values ('test-driver-second-company', ${otherSupplier.companyId}, ${driver.id}, 'driver')`.execute(db);
    await fundOrder(db, buyer, { orderId: order.id });
    await assignDriver(db, supplier, { orderId: order.id, driverId: driver.id });
    await dispatchOrder(db, supplier, order.id);
  });
  const handover = await mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity: 1 }));
  const switchedDriver = { ...driver, companyId: otherSupplier.companyId };
  const database = await getDb();
  const assignedOrder = await actorOrder(database, driver, order.id);
  assert.equal((await inspectDelivery(database, driver, { token: handover.token })).orderId, order.id);
  assert.ok((await marketplaceState(driver)).orders.some(({ id }) => id === order.id));
  await assert.rejects(actorOrder(database, switchedDriver, order.id), /Order was not found/);
  await assert.rejects(inspectDelivery(database, switchedDriver, { token: handover.token }), /Order was not found/);
  assert.throws(() => supplierAccess(switchedDriver, assignedOrder, true), /cannot perform/);
  assert.ok(!(await marketplaceState(switchedDriver)).orders.some(({ id }) => id === order.id));
});

test('marketplace state withholds buyer-only street addresses from other companies', async () => {
  const buyer = actor('buyer');
  const supplier = actor('supplier');
  const privateAddress = '17 Fixture Street, Woodstock, Cape Town';
  await mutate(async (db) => {
    const company = await record<Company>(db, tables.companies, buyer.companyId);
    assert.ok(company);
    await update(db, tables.companies, buyer.companyId, { ...company, location: privateAddress });
  });
  assert.equal((await marketplaceState(buyer)).companies.find(({ id }) => id === buyer.companyId)?.location, privateAddress);
  const publicState = await marketplaceState(supplier);
  assert.equal(publicState.companies.find(({ id }) => id === buyer.companyId)?.location, '');
  assert.equal((await marketplaceState(buyer)).companies.find(({ id }) => id === supplier.companyId)?.location, 'Epping, Cape Town');
});

test('hidden reviews and moderation notes stay in the reviewer workspace', async () => {
  const buyer = actor('buyer');
  const otherSupplier = actor('supplier2');
  const reviewer = actor('admin');
  const review = await mutate((db) => reviewOrder(db, buyer, { orderId: 'demo-order-complete', rating: 5, comment: 'Arrived as agreed.' }));
  const moderationNote = 'Reviewed against the evidence.';
  await mutate((db) => moderateReview(db, reviewer, { reviewId: review.id, hidden: true, note: moderationNote }));
  const hiddenReview = (await marketplaceState(reviewer)).reviews.find(({ id }) => id === review.id);
  assert.ok(hiddenReview);
  assert.equal(Reflect.get(hiddenReview, 'moderationNote'), moderationNote);
  assert.ok(!(await marketplaceState(otherSupplier)).reviews.some(({ id }) => id === review.id));
  await mutate((db) => moderateReview(db, reviewer, { reviewId: review.id, hidden: false, note: moderationNote }));
  const visibleReview = (await marketplaceState(otherSupplier)).reviews.find(({ id }) => id === review.id);
  assert.ok(visibleReview);
  assert.equal(visibleReview.comment, review.comment);
  assert.ok(!Object.hasOwn(visibleReview, 'moderationNote'));
  assert.ok(!Object.hasOwn(visibleReview, 'hidden'));
  const reply = await mutate((db) => replyReview(db, actor('supplier'), { reviewId: review.id, body: 'Thank you for the review.' }));
  assert.equal(reply.reply.body, 'Thank you for the review.');
  assert.equal(reply.moderationNote, undefined);
  const moderated = (await marketplaceState(reviewer)).reviews.find(({ id }) => id === review.id);
  assert.equal(moderated && Reflect.get(moderated, 'moderationNote'), moderationNote);
});
