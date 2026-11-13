import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { sql } from 'kysely';
import { decode, hashes, Wallet } from 'xrpl';
import { getDb, mutate } from '../src/server/db';
import { authorizeDelivery, dispatchOrder, enableXrplOrder, redeemDelivery } from '../src/server/orders';
import { acceptQuote } from '../src/server/procurement';
import { demoAccounts, ensureDemoSeed } from '../src/server/seed';
import { getXrplState, pauseXrplMandate, requeueXrplPayment, runXrplJobs, stageXrplIntent, upsertXrplMandate, type XrplDecisionProvider } from '../src/server/xrpl';
import type { Actor } from '../src/shared/marketplace';

const rpcUrl = 'https://s.altnet.rippletest.net:51234/';
const demoActor = (role: keyof typeof demoAccounts): Actor => ({ ...demoAccounts[role], memberships: [] });

test('XRPL jobs pin a supplier, persist one signed blob, confirm exactly once, and independently enforce caps', async (t) => {
  const dbRoot = await mkdtemp(join(tmpdir(), 'stockpact-xrpl-policy-'));
  const signer = Wallet.generate();
  const recipient = Wallet.generate();
  const env = { DATABASE_URL: '', STOCKPACT_DB_PATH: join(dbRoot, 'database'), STOCKPACT_DEMO: 'true', STOCKPACT_XRPL_ENABLED: 'true',
    STOCKPACT_XRPL_TESTNET_ACCOUNT: signer.address, STOCKPACT_XRPL_TESTNET_SEED: signer.seed!,
    STOCKPACT_XRPL_TESTNET_SUPPLIER_ID: demoAccounts.supplier.companyId, STOCKPACT_XRPL_TESTNET_RECIPIENT: recipient.address,
    STOCKPACT_XRPL_TESTNET_DESTINATION_TAG: '0', STOCKPACT_XRPL_MAX_PAYMENT_DROPS: '5000000' };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    await (await getDb()).destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dbRoot, { recursive: true, force: true });
  });

  const buyer = demoActor('buyer');
  const supplier = demoActor('supplier');
  const anotherSupplier = demoActor('supplier2');
  const reviewer = demoActor('admin');
  await ensureDemoSeed();
  const input = { supplierId: supplier.companyId, recipient: recipient.address, destinationTag: 0, maxDrops: '4000000', totalDrops: '4000000' };
  await assert.rejects(mutate((db) => upsertXrplMandate(db, buyer, { ...input, supplierId: anotherSupplier.companyId })), /match the configured/);
  await assert.rejects(mutate((db) => upsertXrplMandate(db, buyer, { ...input, destinationTag: 1 })), /match the configured/);
  await assert.rejects(mutate((db) => upsertXrplMandate(db, { ...buyer, role: 'approver' }, input)), /Your role/);
  await assert.rejects(mutate((db) => upsertXrplMandate(db, { ...buyer, demoRole: undefined }, input)), /fictional workspace/);
  const mandate = await mutate((db) => upsertXrplMandate(db, buyer, input));
  await assert.rejects(mutate((db) => pauseXrplMandate(db, anotherSupplier, { mandateId: mandate.id, paused: true })), /not found/);
  const order = await mutate((db) => acceptQuote(db, buyer, 'demo-quote-1'));
  await mutate((db) => enableXrplOrder(db, buyer, order.id));
  await mutate((db) => dispatchOrder(db, supplier, order.id));

  const redeem = async (quantity: number) => {
    const qr = await mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity }));
    const result = await mutate((db) => redeemDelivery(db, supplier, { token: qr.token }));
    assert.ok('xrplAttemptId' in result && typeof result.xrplAttemptId === 'string');
    return result.xrplAttemptId;
  };
  const first = await redeem(12);
  const second = await redeem(8);
  const staged = (await getXrplState(buyer)).attempts.find((item) => item.id === first)!;
  assert.equal((await mutate((db) => stageXrplIntent(db, order.id, staged.sourceId)))?.id, first);
  assert.equal(staged.drops, '2670000');
  assert.equal((await getXrplState(supplier)).attempts.length, 2);
  assert.equal((await getXrplState(anotherSupplier)).attempts.length, 0);
  assert.equal((await getXrplState(reviewer)).attempts.length, 0);
  assert.equal((await getXrplState({ ...buyer, demoRole: undefined })).attempts.length, 0);

  let decisions = 0;
  let confirms = false;
  let denySecond = false;
  const broadcast: string[] = [];
  const decision: XrplDecisionProvider = async (evidence) => {
    decisions++;
    assert.equal(evidence.acceptedQuantity, evidence.attemptId === first ? 12 : 8);
    assert.equal(evidence.quoteAmountCents, evidence.attemptId === first ? 267000 : 178000);
    assert.equal(evidence.drops, evidence.attemptId === first ? staged.drops : '1780000');
    assert.equal(Object.isFrozen(evidence), true);
    assert.equal('recipient' in evidence, false);
    return { requestPayment: !(denySecond && evidence.attemptId === second), reason: 'No browser or signer should receive this raw text.' };
  };
  const body = (result: object) => Response.json({ result });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(input, rpcUrl);
    const { method, params: [params] } = JSON.parse(String(init.body));
    if (method === 'server_info') return body({ info: { network_id: 1, validated_ledger: { seq: confirms ? 10003 : 10000, age: 1 } } });
    if (method === 'account_info') return body({ validated: true, account_data: { Account: signer.address, Sequence: 11 } });
    if (method === 'fee') return body({ drops: { open_ledger_fee: '12', minimum_fee: '10' } });
    if (method === 'submit') {
      const persisted = await sql<{ tx_hash: string; signed: { blob: string } }>`select tx_hash, signed from xrpl_payment_attempts where id = ${first}`.execute(await getDb());
      assert.equal(persisted.rows[0].signed.blob, params.tx_blob);
      assert.equal(persisted.rows[0].tx_hash, hashes.hashSignedTx(params.tx_blob));
      broadcast.push(params.tx_blob);
      throw new Error('simulated loss after broadcast');
    }
    assert.equal(method, 'tx');
    if (!confirms) return body({ error: 'txnNotFound', searched_all: false });
    const transaction = decode(broadcast[0]);
    return body({ validated: true, hash: hashes.hashSignedTx(broadcast[0]), ledger_index: 10002, tx_json: transaction,
      meta: { TransactionResult: 'tesSUCCESS', delivered_amount: transaction.Amount } });
  });

  const runs = await Promise.all([runXrplJobs(decision, { attemptId: first }), runXrplJobs(decision, { attemptId: first })]);
  assert.equal(runs.reduce((total, job) => total + job.processed, 0), 1);
  assert.equal(decisions, 1);
  assert.equal(broadcast.length, 1);
  const pending = (await getXrplState(buyer)).attempts.find((item) => item.id === first)!;
  assert.equal(pending.status, 'pending');
  assert.equal('signed' in pending, false);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, buyer, { attemptId: first })), /never signed/);
  assert.equal((await getXrplState(buyer)).mandates[0].reservedDrops, staged.drops);
  const blocked = await runXrplJobs(decision, { attemptId: second });
  assert.equal(blocked.attempt?.status, 'blocked');
  assert.match(blocked.attempt?.reason ?? '', /remaining total/);
  assert.equal(decisions, 2);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, supplier, { attemptId: second })), /not found/);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, { ...buyer, role: 'approver' }, { attemptId: second })), /Your role/);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, buyer, { attemptId: second })), /remaining total/);

  await mutate((db) => pauseXrplMandate(db, buyer, { mandateId: mandate.id, paused: true }));
  await sql`update xrpl_payment_attempts set next_attempt_at = now() where id = ${first}`.execute(await getDb());
  const paused = await runXrplJobs(decision, { attemptId: first });
  assert.equal(paused.attempt?.status, 'pending');
  assert.match(paused.attempt?.reason ?? '', /prevents re-broadcast/);
  assert.equal(broadcast.length, 1);
  confirms = true;
  await sql`update xrpl_payment_attempts set next_attempt_at = now() where id = ${first}`.execute(await getDb());
  const settled = await runXrplJobs(decision, { attemptId: first });
  assert.equal(settled.attempt?.status, 'confirmed');
  assert.equal(settled.attempt?.hash, pending.hash);
  assert.equal(settled.attempt?.ledgerIndex, 10002);
  assert.equal(broadcast.length, 1);
  assert.equal((await runXrplJobs(decision, { attemptId: first })).processed, 0);
  const final = (await getXrplState(buyer)).mandates[0];
  assert.equal(final.usedDrops, staged.drops);
  assert.equal(final.reservedDrops, '0');
  assert.equal(final.paused, true);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, buyer, { attemptId: first })), /never signed/);
  await assert.rejects(mutate((db) => requeueXrplPayment(db, buyer, { attemptId: second })), /paused/);
  await mutate((db) => upsertXrplMandate(db, buyer, { ...input, totalDrops: '5000000' }));
  await mutate((db) => pauseXrplMandate(db, buyer, { mandateId: mandate.id, paused: false }));
  const requeues = await Promise.allSettled([mutate((db) => requeueXrplPayment(db, buyer, { attemptId: second })),
    mutate((db) => requeueXrplPayment(db, buyer, { attemptId: second }))]);
  assert.equal(requeues.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.ok(requeues.some((result) => result.status === 'fulfilled' && result.value.xrplAttemptId === second));
  const queued = (await getXrplState(supplier)).attempts.find((item) => item.id === second)!;
  assert.equal(queued.status, 'queued');
  assert.equal(queued.drops, '1780000');
  assert.equal(queued.destinationTag, 0);
  assert.equal(queued.recipient, recipient.address);
  assert.equal(queued.hash, undefined);
  const audit = await sql<{ data: { actorId: string } }>`select data from audit_events where company_id = ${buyer.companyId}
    and data->>'action' = 'xrpl_payment_requeued' and data->>'recordId' = ${second}`.execute(await getDb());
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].data.actorId, buyer.id);

  denySecond = true;
  const freshDecision = await runXrplJobs(decision, { attemptId: second });
  assert.equal(freshDecision.attempt?.status, 'blocked');
  assert.match(freshDecision.attempt?.reason ?? '', /did not request/);
  assert.equal(decisions, 3);
  assert.equal(broadcast.length, 1);
});
