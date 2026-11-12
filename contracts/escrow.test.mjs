import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { createPublicClient, createWalletClient, custom, defineChain, keccak256, parseEventLogs, stringToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deliveryAmountCents, escrowAbi, escrowOrderReference, orderKey, releaseTypedData, toTokenUnits } from '../src/integrations/escrow/shared.ts';
import { compileContracts } from './compile.mjs';

const contracts = compileContracts();
const chain = defineChain({
  id: 1337,
  name: 'Local escrow tests',
  nativeCurrency: { name: 'Test gas', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [] } },
});
const quantity = 20n;
const unitsPerCent = 10_000n;
const totalCents = 113_773n;
const funded = totalCents * unitsPerCent;
const hashText = (text) => keccak256(stringToHex(text));

async function createFixture(t) {
  const privateKeys = Array.from({ length: 5 }, () => generatePrivateKey());
  const hre = await createHardhatRuntimeEnvironment({
    networks: {
      escrowLocal: {
        type: 'edr-simulated',
        chainId: chain.id,
        chainType: 'l1',
        hardfork: 'cancun',
        throwOnTransactionFailures: false,
        accounts: privateKeys.map((privateKey) => ({ privateKey, balance: 1_000n * 10n ** 18n })),
      },
    },
  });
  const connection = await hre.network.create('escrowLocal');
  const { provider } = connection;
  t.after(() => connection.close());
  const transport = custom(provider);
  const [buyer, supplier, driver, attestor, resolver] = privateKeys.map((key) => privateKeyToAccount(key));
  const publicClient = createPublicClient({ chain, transport, pollingInterval: 20 });
  const wallet = (account) => createWalletClient({ chain, transport, account });
  const receipt = (hash) => publicClient.waitForTransactionReceipt({ hash });

  async function deploy(contract, args) {
    const result = await receipt(await wallet(buyer).deployContract({ ...contract, args }));
    assert.equal(result.status, 'success');
    assert.ok(result.contractAddress);
    return { address: result.contractAddress, abi: contract.abi };
  }

  const token = await deploy(contracts.TestStock, [buyer.address, funded * 10n]);
  const escrow = await deploy(contracts.StockPactEscrow, [token.address, attestor.address, resolver.address]);
  const send = (account, contract, functionName, args) => wallet(account).writeContract({ ...contract, functionName, args, gas: 700_000n });

  async function write(account, contract, functionName, args) {
    const result = await receipt(await send(account, contract, functionName, args));
    assert.equal(result.status, 'success', functionName);
    return result;
  }

  function rejects(account, functionName, args) {
    return assert.rejects(publicClient.simulateContract({ ...escrow, account, functionName, args }));
  }

  async function createOrder(name) {
    const key = orderKey(name);
    const orderId = await publicClient.readContract({ ...escrow, functionName: 'orderReference', args: [key, buyer.address] });
    assert.equal(orderId, escrowOrderReference(name, buyer.address));
    await write(buyer, token, 'approve', [escrow.address, funded]);
    const result = await write(buyer, escrow, 'fund', [key, supplier.address, quantity, funded]);
    const [event] = parseEventLogs({ abi: escrowAbi, eventName: 'Funded', logs: result.logs });
    assert.equal(event.args.orderId, orderId);
    assert.equal(event.args.amount, funded);
    return { key, orderId };
  }

  async function releaseAuthorization(orderId, label, previousQuantity, deliveryQuantity, overrides = {}) {
    const now = (await publicClient.getBlock()).timestamp;
    return {
      orderId,
      nonce: hashText(label),
      supplier: supplier.address,
      previousQuantity,
      quantity: deliveryQuantity,
      amount: toTokenUnits(deliveryAmountCents(Number(totalCents), Number(quantity), Number(previousQuantity), Number(deliveryQuantity)), 6),
      expiresAt: now + 600n,
      ...overrides,
    };
  }

  async function signedRelease(authorization, buyerSigner = buyer, platformSigner = attestor, overrides = {}) {
    const typedData = releaseTypedData({ chainId: chain.id, contract: escrow.address }, {
      ...authorization,
      previousQuantity: Number(authorization.previousQuantity),
      quantity: Number(authorization.quantity),
      expiresAt: Number(authorization.expiresAt),
      amount: authorization.amount.toString(),
    });
    typedData.domain = { ...typedData.domain, ...overrides };
    const signatures = await Promise.all([buyerSigner.signTypedData(typedData), platformSigner.signTypedData(typedData)]);
    return [authorization, ...signatures];
  }

  function balance(address) {
    return publicClient.readContract({ ...token, functionName: 'balanceOf', args: [address] });
  }

  async function advance(seconds) {
    await provider.request({ method: 'evm_increaseTime', params: [seconds] });
    await provider.request({ method: 'evm_mine', params: [] });
  }

  return { buyer, supplier, driver, resolver, token, escrow, send, receipt, write, rejects, createOrder, releaseAuthorization, signedRelease, balance, advance };
}

test('local EVM escrow proves shipment releases, replay protection, and dispute accounting', async (t) => {
  const f = await createFixture(t);
  await t.test('funds the exact quote and releases 12 and 8 cases without leaving rounding residual', async () => {
    const { key, orderId } = await f.createOrder('20 cases of coffee');
    assert.equal(await f.balance(f.escrow.address), funded);
    await f.rejects(f.buyer, 'fund', [key, f.supplier.address, quantity, funded]);

    const first = await f.releaseAuthorization(orderId, '12 cases', 0n, 12n);
    const signed = await f.signedRelease(first);
    await f.rejects(f.driver, 'release', signed);
    await f.write(f.supplier, f.escrow, 'setDriver', [orderId, f.driver.address]);
    const settlement = await f.write(f.driver, f.escrow, 'release', signed);
    assert.match(settlement.transactionHash, /^0x[0-9a-f]{64}$/i);
    const [releaseEvent] = parseEventLogs({ abi: escrowAbi, eventName: 'Released', logs: settlement.logs });
    assert.equal(releaseEvent.args.nonce, first.nonce);
    assert.equal(releaseEvent.args.submittedBy, f.driver.address);
    assert.equal(await f.balance(f.driver.address), 0n);
    assert.equal(await f.balance(f.supplier.address), first.amount);
    await f.rejects(f.supplier, 'release', signed);

    const stale = await f.releaseAuthorization(orderId, 'stale duplicate quantity', 0n, 12n);
    await f.rejects(f.supplier, 'release', await f.signedRelease(stale));
    const final = await f.releaseAuthorization(orderId, 'remaining 8 cases', 12n, 8n);
    await f.write(f.supplier, f.escrow, 'release', await f.signedRelease(final));
    assert.equal(await f.balance(f.supplier.address), funded);
    assert.equal(await f.balance(f.escrow.address), 0n);
  });

  await t.test('rejects wrong parties, expired and cancelled codes, altered terms, and mismatched signing domains', async () => {
    const { orderId } = await f.createOrder('signature bounds');
    const valid = await f.releaseAuthorization(orderId, 'signature nonce', 0n, 4n);
    const invalid = [
      await f.signedRelease(valid, f.driver),
      await f.signedRelease(valid, f.buyer, f.driver),
      await f.signedRelease({ ...valid, supplier: f.driver.address }),
      await f.signedRelease({ ...valid, amount: valid.amount + unitsPerCent }),
      await f.signedRelease({ ...valid, quantity: quantity + 1n }),
      await f.signedRelease({ ...valid, expiresAt: valid.expiresAt - 800n }),
      await f.signedRelease(valid, undefined, undefined, { chainId: chain.id + 1 }),
      await f.signedRelease(valid, undefined, undefined, { verifyingContract: f.driver.address }),
    ];
    for (const signed of invalid) await f.rejects(f.supplier, 'release', signed);
    await f.rejects(f.driver, 'cancelAuthorization', [orderId, valid.nonce]);
    await f.write(f.buyer, f.escrow, 'cancelAuthorization', [orderId, valid.nonce]);
    await f.rejects(f.supplier, 'release', await f.signedRelease(valid));
  });

  await t.test('concurrent supplier and driver scans can pay only once', async () => {
    const { orderId } = await f.createOrder('two scanners');
    await f.write(f.supplier, f.escrow, 'setDriver', [orderId, f.driver.address]);
    const authorization = await f.releaseAuthorization(orderId, 'same nonce', 0n, 10n);
    const signed = await f.signedRelease(authorization);
    const before = await f.balance(f.supplier.address);
    const hashes = await Promise.all([
      f.send(f.supplier, f.escrow, 'release', signed),
      f.send(f.driver, f.escrow, 'release', signed),
    ]);
    const receipts = await Promise.all(hashes.map(f.receipt));
    assert.equal(receipts.filter((result) => result.status === 'success').length, 1);
    assert.equal(await f.balance(f.supplier.address) - before, authorization.amount);
  });

  await t.test('freezes the outstanding balance on dispute and prevents award overpayment', async () => {
    const { orderId } = await f.createOrder('partially disputed');
    const accepted = await f.releaseAuthorization(orderId, 'undisputed cases', 0n, 12n);
    await f.write(f.supplier, f.escrow, 'release', await f.signedRelease(accepted));
    const remaining = funded - accepted.amount;
    await f.write(f.buyer, f.escrow, 'openDispute', [orderId]);
    const blocked = await f.releaseAuthorization(orderId, 'blocked delivery', 12n, 8n);
    await f.rejects(f.supplier, 'release', await f.signedRelease(blocked));
    await f.rejects(f.supplier, 'resolveDispute', [orderId, remaining]);
    await f.rejects(f.resolver, 'resolveDispute', [orderId, remaining + unitsPerCent]);
    const buyerBalance = await f.balance(f.buyer.address);
    const supplierBalance = await f.balance(f.supplier.address);
    const supplierAward = 500n * unitsPerCent;
    await f.write(f.resolver, f.escrow, 'resolveDispute', [orderId, supplierAward]);
    assert.equal(await f.balance(f.buyer.address) - buyerBalance, remaining - supplierAward);
    assert.equal(await f.balance(f.supplier.address) - supplierBalance, supplierAward);
    await f.rejects(f.resolver, 'resolveDispute', [orderId, 0n]);
  });

  await t.test('allows timeout refunds of unresolved balances without redirecting the payout', async () => {
    const { orderId } = await f.createOrder('timed out');
    await f.write(f.supplier, f.escrow, 'openDispute', [orderId]);
    await f.rejects(f.buyer, 'refundExpired', [orderId]);
    const buyerBalance = await f.balance(f.buyer.address);
    await f.advance(31 * 24 * 60 * 60);
    await f.rejects(f.resolver, 'resolveDispute', [orderId, funded]);
    await f.write(f.driver, f.escrow, 'refundExpired', [orderId]);
    assert.equal(await f.balance(f.buyer.address) - buyerBalance, funded);
  });
});
