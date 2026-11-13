import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { sql } from 'kysely';
import type { Actor } from '../src/shared/marketplace';
import { getDb, mutate, record, tables, update } from '../src/server/db';
import { postRequestMessage, readEarlierRequestMessages } from '../src/server/request-chat';
import { demoAccounts, ensureDemoSeed, resetDemo } from '../src/server/seed';
import { marketplaceState } from '../src/server/state';

const actor = (role: keyof typeof demoAccounts): Actor => ({ ...demoAccounts[role], memberships: [] });
const buyer = actor('buyer');
const supplier = actor('supplier');
const otherSupplier = actor('supplier2');
const reviewer = actor('admin');
const approver: Actor = { ...buyer, role: 'approver' };
const thread = { requestId: 'demo-request-sent', supplierId: supplier.companyId };
let directory: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stockpact-chat-test-'));
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

test('invited parties exchange private messages with scoped notifications and replay safety', async () => {
  const question = { ...thread, body: 'Can you deliver before lunch?', messageId: randomUUID() };
  const first = await mutate((db) => postRequestMessage(db, buyer, question));
  assert.equal((await mutate((db) => postRequestMessage(db, buyer, question))).id, first.id);
  await assert.rejects(mutate((db) => postRequestMessage(db, buyer, { ...question, body: 'Edited by retry.' })), /already used/);
  await mutate((db) => postRequestMessage(db, supplier, { ...thread, body: 'Yes, between 9 am and 11 am.' }));
  await assert.rejects(mutate((db) => postRequestMessage(db, otherSupplier, { ...thread, body: 'I can see the competition.' })), /conversation was not found/);
  await assert.rejects(mutate((db) => postRequestMessage(db, approver, { ...thread, body: 'Can an approver post?' })), /conversation was not found/);
  await assert.rejects(mutate((db) => postRequestMessage(db, reviewer, { ...thread, body: 'Can a reviewer post?' })), /conversation was not found/);
  await assert.rejects(readEarlierRequestMessages(await getDb(), otherSupplier, { ...thread, beforeId: first.id }), /conversation was not found/);

  const readThread = async (viewer: Actor) => (await marketplaceState(viewer)).requests.find((item) => item.id === thread.requestId)?.conversations;
  for (const viewer of [buyer, supplier, approver]) {
    const entries = await readThread(viewer);
    assert.equal(entries?.length, 1);
    assert.deepEqual(entries[0].messages.map((message) => [message.authorCompanyId, message.body]), [
      [buyer.companyId, question.body], [supplier.companyId, 'Yes, between 9 am and 11 am.'],
    ]);
  }
  assert.equal((await readThread(otherSupplier))?.length ?? 0, 0);
  assert.equal(await readThread(reviewer), undefined);

  const notices = (await marketplaceState(supplier)).notifications.filter((notice) => notice.title === 'New request message');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].href, `#requests/${thread.requestId}/chat/${thread.supplierId}`);
  assert.ok(!notices[0].body.includes(question.body));
  await mutate(async (db) => {
    const invitationId = `${thread.requestId}:${thread.supplierId}`;
    const previous = await record<object>(db, tables.invitations, invitationId);
    await update(db, tables.invitations, invitationId, { ...previous, status: 'declined' });
  });
  assert.equal((await readThread(supplier))?.[0].messages.length, 2);
  await assert.rejects(mutate((db) => postRequestMessage(db, supplier, { ...thread, body: 'After declining.' })), /conversation is closed/);
  assert.equal((await mutate((db) => postRequestMessage(db, buyer, question))).id, first.id);
});

test('message pages and demo reset follow the invitation lifecycle', async () => {
  const alternative = { ...thread, supplierId: otherSupplier.companyId };
  await mutate(async (db) => {
    for (let index = 1; index <= 35; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      await sql`insert into request_messages (id, request_id, supplier_id, author_company_id, author_user_id, author_name, body, created_at)
        values (${randomUUID()}, ${alternative.requestId}, ${alternative.supplierId}, ${buyer.companyId}, ${buyer.id}, ${buyer.name}, ${`Message ${index}`}, ${createdAt}::timestamptz)`.execute(db);
    }
  });
  const newest = (await marketplaceState(otherSupplier)).requests.find((request) => request.id === thread.requestId)?.conversations?.[0];
  assert.ok(newest);
  assert.equal(newest.messages.length, 30);
  assert.equal(newest.messages[0].body, 'Message 6');
  assert.equal(newest.messages.at(-1)?.body, 'Message 35');
  assert.equal(newest.hasEarlier, true);
  const earlier = await readEarlierRequestMessages(await getDb(), buyer, { ...alternative, beforeId: newest.messages[0].id });
  assert.equal(earlier.hasEarlier, false);
  assert.deepEqual(earlier.messages.map((message) => message.body), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);
  await resetDemo();
  assert.equal((await marketplaceState(buyer)).requests.find((request) => request.id === thread.requestId)?.conversations?.length ?? 0, 0);
});
