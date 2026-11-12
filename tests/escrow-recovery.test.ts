import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { createPublicClient, createWalletClient, custom, defineChain, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { compileContracts } from '../contracts/compile.mjs';
import { fundEscrow, releaseEscrow, revokeEscrowAuthorization, signRelease, signWalletProof } from '../src/integrations/escrow/browser';
import { escrowStatus } from '../src/integrations/escrow/server';
import { getDb, mutate, record, tables } from '../src/server/db';
import { authorizeDelivery, cancelDelivery, dispatchOrder, fundOrder, inspectDelivery, prepareFunding, redeemDelivery, signDelivery } from '../src/server/orders';
import { acceptQuote } from '../src/server/procurement';
import { demoAccounts, ensureDemoSeed } from '../src/server/seed';
import { setWallet, walletChallenge } from '../src/server/settings';
import type { Order } from '../src/shared/marketplace';

test('testnet wallet and database recover funding and a partial release from their original receipts', { timeout: 120_000 }, async (t) => {
  const { createHardhatRuntimeEnvironment } = await import('hardhat/hre');
  const chain = defineChain({
    id: 84532,
    name: 'StockPact local test chain',
    nativeCurrency: { name: 'Test gas', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
  const privateKeys = Array.from({ length: 4 }, () => generatePrivateKey());
  const [buyerWallet, supplierWallet, attestor, resolver] = privateKeys.map((key) => privateKeyToAccount(key));
  const hre = await createHardhatRuntimeEnvironment({
    networks: { stockpact: { type: 'edr-simulated', chainType: 'l1', chainId: chain.id, hardfork: 'cancun',
      accounts: privateKeys.map((privateKey) => ({ privateKey, balance: 100n * 10n ** 18n })) } },
  });
  const connection = await hre.network.create('stockpact');
  t.after(() => connection.close());
  const { provider } = connection;
  const transport = custom(provider);
  const chainClient = createPublicClient({ chain, transport, pollingInterval: 20 });
  const deployer = createWalletClient({ chain, transport, account: buyerWallet });
  const { TestStock, StockPactEscrow } = compileContracts();

  async function deploy(contract: typeof TestStock, args: readonly unknown[]) {
    const hash = await deployer.deployContract({ ...contract, bytecode: contract.bytecode as Hex, args });
    const receipt = await chainClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    assert.ok(receipt.contractAddress);
    return receipt.contractAddress;
  }

  const token = await deploy(TestStock, [buyerWallet.address, 10_000n * 10n ** 6n]);
  const escrow = await deploy(StockPactEscrow, [token, attestor.address, resolver.address]);
  const rpcUrl = 'https://stockpact-local-test.invalid/';
  const testRoot = resolve('.stockpact');
  await mkdir(testRoot, { recursive: true });
  const dbPath = await mkdtemp(join(testRoot, 'escrow-test-'));
  assert.equal(dirname(dbPath), testRoot);
  const variables = {
    DATABASE_URL: '', STOCKPACT_DB_PATH: dbPath, STOCKPACT_DEMO: 'true', STOCKPACT_ESCROW_MODE: 'testnet',
    STOCKPACT_TESTNET_CHAIN_ID: String(chain.id), STOCKPACT_TESTNET_RPC_URL: rpcUrl,
    STOCKPACT_TESTNET_TOKEN_ADDRESS: token, STOCKPACT_TESTNET_ESCROW_ADDRESS: escrow,
    STOCKPACT_TESTNET_ATTESTOR_KEY: privateKeys[2],
    STOCKPACT_TESTNET_TOKEN_DECIMALS: '6', STOCKPACT_TESTNET_TOKEN_SYMBOL: 'TSTK', STOCKPACT_TESTNET_CONFIRMATIONS: '1',
  };
  const oldVariables = Object.fromEntries(Object.keys(variables).map((name) => [name, process.env[name]]));
  Object.assign(process.env, variables);
  t.after(async () => {
    try { await (await getDb()).destroy(); }
    finally {
      for (const [name, value] of Object.entries(oldVariables)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(dbPath, { recursive: true, force: true });
    }
  });

  await ensureDemoSeed();
  const hiddenReceipts = new Set<string>();
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== rpcUrl) return realFetch(input, init);
    const rawBody = init?.body ?? (input instanceof Request ? await input.text() : '');
    const request = JSON.parse(String(rawBody));
    const waiting = request.method === 'eth_getTransactionReceipt' && hiddenReceipts.has(request.params[0]);
    const result = waiting ? null : await provider.request({ method: request.method, params: request.params });
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  let selectedWallet = buyerWallet.address;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ethereum: {
    request: async (request: { method: string; params?: unknown[] }) => request.method === 'eth_requestAccounts'
      ? [selectedWallet]
      : provider.request(request),
  } } });
  t.after(() => Reflect.deleteProperty(globalThis, 'window'));
  const buyer = { ...demoAccounts.buyer, memberships: [] };
  const supplier = { ...demoAccounts.supplier, memberships: [] };
  const config = escrowStatus();
  if (config.mode !== 'testnet') assert.fail('Testnet configuration did not load');
  const liveConfig = config;

  for (const [actor, address] of [[buyer, buyerWallet.address], [supplier, supplierWallet.address]] as const) {
    selectedWallet = address;
    const proof = await mutate((db) => walletChallenge(db, actor, { address }));
    const signature = await signWalletProof(liveConfig, proof);
    await mutate((db) => setWallet(db, actor, { challenge: proof.challenge, signature }));
  }

  const order = await mutate((db) => acceptQuote(db, buyer, 'demo-quote-1'));
  assert.equal(order.quantity, 20);
  const terms = await mutate((db) => prepareFunding(db, buyer, order.id));
  selectedWallet = buyerWallet.address;
  const fundingHash = await fundEscrow(liveConfig, terms);
  hiddenReceipts.add(fundingHash);
  const fundingResult = await mutate((db) => fundOrder(db, buyer, { orderId: order.id, transactionHash: fundingHash }));
  assert.ok('paymentStatus' in fundingResult);
  assert.equal(fundingResult.paymentStatus, 409);
  const pendingFunding = await record<Order>(await getDb(), tables.orders, order.id);
  assert.equal(pendingFunding?.transactions.at(-1)?.status, 'pending');
  assert.equal(pendingFunding?.fundedCents, 0);

  hiddenReceipts.delete(fundingHash);
  await mutate((db) => fundOrder(db, buyer, { orderId: order.id, transactionHash: fundingHash }));
  await mutate((db) => dispatchOrder(db, supplier, order.id));

  async function signDeliveryCode(quantity: number) {
    selectedWallet = buyerWallet.address;
    const staged = await mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity }));
    assert.ok(staged.authorization);
    assert.equal(staged.platformSignature, undefined);
    const signature = await signRelease(liveConfig, { authorization: staged.authorization, buyerWallet: buyerWallet.address });
    const approved = await mutate((db) => signDelivery(db, buyer, { token: staged.token, signature }));
    assert.equal(approved.platformSignature, undefined);
    const inspected = await mutate((db) => inspectDelivery(db, supplier, { token: staged.token }));
    assert.ok(inspected.authorization && inspected.buyerSignature && inspected.platformSignature);
    return { token: staged.token, authorization: inspected.authorization, buyerSignature: inspected.buyerSignature,
      platformSignature: inspected.platformSignature };
  }

  async function submitDelivery(quantity: number) {
    const inspected = await signDeliveryCode(quantity);
    selectedWallet = supplierWallet.address;
    const hash = await releaseEscrow(liveConfig, { authorization: inspected.authorization, buyerSignature: inspected.buyerSignature,
      platformSignature: inspected.platformSignature, supplierWallet: supplierWallet.address });
    return { token: inspected.token, transactionHash: hash };
  }

  const first = await submitDelivery(12);
  hiddenReceipts.add(first.transactionHash);
  const releaseResult = await mutate((db) => redeemDelivery(db, supplier, first));
  assert.ok('paymentStatus' in releaseResult);
  assert.equal(releaseResult.paymentStatus, 409);
  const waiting = await record<Order>(await getDb(), tables.orders, order.id);
  assert.equal(waiting?.acceptedQuantity, 0);
  assert.equal(waiting?.transactions.at(-1)?.status, 'pending');
  assert.equal((await mutate((db) => inspectDelivery(db, supplier, { token: first.token }))).transactionHash, first.transactionHash);

  let shiftedClock = Date.now() + 360_000;
  t.mock.method(Date, 'now', () => shiftedClock);
  await provider.request({ method: 'evm_increaseTime', params: [360] });
  await provider.request({ method: 'evm_mine', params: [] });
  await assert.rejects(mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity: 8 })), /already advanced on chain/);

  hiddenReceipts.delete(first.transactionHash);
  await mutate((db) => redeemDelivery(db, supplier, first));
  const partial = await record<Order>(await getDb(), tables.orders, order.id);
  assert.equal(partial?.acceptedQuantity, 12);
  assert.equal(partial?.transactions.filter(({ hash }) => hash === first.transactionHash).length, 1);
  await assert.rejects(mutate((db) => redeemDelivery(db, supplier, { token: first.token })), /already been used/);

  const revocable = await signDeliveryCode(8);
  const current = await mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity: 8, existingOnly: true }));
  assert.equal(current.token, revocable.token);
  assert.ok('requiresOnChainProof' in current && current.requiresOnChainProof);
  await assert.rejects(mutate((db) => cancelDelivery(db, buyer, { orderId: order.id, token: revocable.token })), /expire on chain/);
  selectedWallet = buyerWallet.address;
  await revokeEscrowAuthorization(liveConfig, { authorization: revocable.authorization, buyerWallet: buyerWallet.address });
  await mutate((db) => cancelDelivery(db, buyer, { orderId: order.id, token: revocable.token }));
  await assert.rejects(mutate((db) => inspectDelivery(db, supplier, { token: revocable.token })), /code was cancelled/);

  const abandoned = await signDeliveryCode(8);
  const droppedHash = `0x${'12'.repeat(32)}` as const;
  hiddenReceipts.add(droppedHash);
  const dropped = await mutate((db) => redeemDelivery(db, supplier, { token: abandoned.token, transactionHash: droppedHash }));
  assert.ok('paymentStatus' in dropped && dropped.paymentStatus === 409);
  shiftedClock += 360_000;
  await assert.rejects(mutate((db) => authorizeDelivery(db, buyer, { orderId: order.id, quantity: 8 })), /expire on chain/);
  await provider.request({ method: 'evm_increaseTime', params: [360] });
  await provider.request({ method: 'evm_mine', params: [] });

  const final = await submitDelivery(8);
  assert.notEqual(final.token, abandoned.token);
  await assert.rejects(mutate((db) => inspectDelivery(db, supplier, { token: abandoned.token })), /code has expired/);
  await mutate((db) => redeemDelivery(db, supplier, final));
  const complete = await record<Order>(await getDb(), tables.orders, order.id);
  assert.equal(complete?.status, 'completed');
  assert.equal(complete.acceptedQuantity, 20);
  assert.equal(complete.releasedCents, order.totalCents);
  assert.equal(complete.transactions.filter(({ status }) => status === 'confirmed').length, 3);
  assert.equal(complete.transactions.find(({ hash }) => hash === droppedHash)?.status, 'failed');
});
