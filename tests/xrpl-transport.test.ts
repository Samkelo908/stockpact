import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, Wallet } from 'xrpl';
import { confirmXrplPayment, prepareXrplPayment, submitXrplPayment, xrplStatus, XrplPolicyError } from '../src/integrations/xrpl/server';

test('isolated signer broadcasts only saved Testnet payments and verifies validated results', async (t) => {
  const signer = Wallet.generate();
  const recipient = Wallet.generate();
  const options = {
    STOCKPACT_XRPL_ENABLED: 'true', STOCKPACT_XRPL_TESTNET_SEED: signer.seed!,
    STOCKPACT_XRPL_TESTNET_ACCOUNT: signer.address, STOCKPACT_XRPL_TESTNET_RECIPIENT: recipient.address,
    STOCKPACT_XRPL_TESTNET_DESTINATION_TAG: '0', STOCKPACT_XRPL_MAX_PAYMENT_DROPS: '1000000',
  };
  const previous = Object.fromEntries(Object.keys(options).map((name) => [name, process.env[name]]));
  Object.assign(process.env, options);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const intent = { intentId: 'intent_12', orderId: 'order_1', recipient: recipient.address, drops: '250000',
    purpose: 'supplier_release', destinationTag: 0 } as const;
  let head = 10_000;
  let networkId = 1;
  let submits = 0;
  let submittedBlob = '';
  let failSubmit = false;
  let receipt: Record<string, unknown> = { error: 'txnNotFound', searched_all: false };
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(input, 'https://s.altnet.rippletest.net:51234/');
    assert.equal(init.redirect, 'error');
    const { method, params: [params] } = JSON.parse(String(init.body));
    assert.equal(params.api_version, 2);
    if (method === 'server_info') return Response.json({ result: { info: { network_id: networkId, validated_ledger: { seq: head, age: 1 } } } });
    if (method === 'account_info') {
      assert.equal(params.ledger_index, head);
      assert.equal(params.account, signer.address);
      return Response.json({ result: { validated: true, account_data: { Account: signer.address, Sequence: 11 } } });
    }
    if (method === 'fee') return Response.json({ result: { drops: { open_ledger_fee: '12', minimum_fee: '10' } } });
    if (method === 'submit') {
      submits++;
      submittedBlob = params.tx_blob;
      assert.equal(params.fail_hard, true);
      if (failSubmit) throw new Error('connection lost after sending');
      return Response.json({ result: { engine_result: 'tesSUCCESS' } });
    }
    assert.equal(method, 'tx');
    assert.equal(params.min_ledger, 10_001);
    assert.equal(params.max_ledger, 10_012);
    return Response.json({ result: receipt });
  });

  assert.deepEqual(xrplStatus(), { mode: 'testnet', network: 'XRPL Testnet', account: signer.address,
    recipient: recipient.address, destinationTag: 0, maxPaymentDrops: '1000000', explorerUrl: 'https://testnet.xrpl.org' });
  for (const change of [{ recipient: Wallet.generate().address }, { destinationTag: 3 }, { drops: '1000001' }, { drops: '1.2' }]) {
    await assert.rejects(prepareXrplPayment({ ...intent, ...change }), (error) => error instanceof XrplPolicyError && error.status === 422);
  }
  networkId = 0;
  await assert.rejects(prepareXrplPayment(intent), /current validated XRPL Testnet/);
  networkId = 1;
  const saved = await prepareXrplPayment(intent);
  assert.equal(submits, 0);
  assert.equal(saved.intentMemo, (await prepareXrplPayment(intent)).intentMemo);
  assert.notEqual(saved.intentMemo, (await prepareXrplPayment({ ...intent, intentId: 'different' })).intentMemo);
  assert.equal(saved.drops, '250000');
  assert.equal(saved.feeDrops, '12');
  assert.equal(saved.sequence, 11);
  assert.equal(saved.destinationTag, 0);
  const transaction = decode(saved.blob);
  assert.equal(transaction.NetworkID, undefined);
  assert.equal(transaction.Destination, recipient.address);
  assert.equal(transaction.Amount, intent.drops);

  await assert.rejects(submitXrplPayment({ ...saved, drops: '250001' }), /saved payment|signed terms/);
  failSubmit = true;
  assert.deepEqual(await submitXrplPayment(saved), { status: 'pending', hash: saved.hash });
  assert.equal(submittedBlob, saved.blob);
  failSubmit = false;
  assert.equal((await submitXrplPayment(saved)).status, 'pending');
  assert.equal(submits, 2);
  assert.equal(submittedBlob, saved.blob);

  head = 10_012;
  assert.equal((await confirmXrplPayment(saved)).status, 'pending');
  receipt = { error: 'txnNotFound', searched_all: true };
  assert.equal((await confirmXrplPayment(saved)).status, 'expired');
  const txJson = { ...transaction, Amount: undefined, DeliverMax: transaction.Amount };
  receipt = { validated: true, hash: saved.hash, ledger_index: 10_010, tx_json: txJson,
    meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '249999' } };
  await assert.rejects(confirmXrplPayment(saved), /authorised amount/);
  receipt.meta = { TransactionResult: 'tecNO_DST' };
  assert.equal((await confirmXrplPayment(saved)).status, 'failed');
  receipt.meta = { TransactionResult: 'tesSUCCESS', delivered_amount: saved.drops };
  assert.deepEqual(await confirmXrplPayment(saved), { status: 'confirmed', hash: saved.hash, ledgerIndex: 10_010, engineResult: 'tesSUCCESS' });
  assert.equal((await submitXrplPayment(saved)).status, 'confirmed');
  assert.equal(submits, 2);
});
