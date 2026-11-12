import {
  createPublicClient,
  http,
  isHex,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  verifyMessage,
  verifyTypedData,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  bytes32,
  deliveryAmountCents,
  escrowAbi,
  escrowOrderReference,
  positiveInteger,
  releaseTypedData,
  toTokenUnits,
  walletAddress,
  walletProofMessage,
  type EscrowAuthorization,
  type EscrowConfiguration,
  type EscrowStatus,
  type FundingTerms,
  type WalletProof,
} from './shared';

const testnets = new Map<number, { networkName: string; explorerUrl: string }>([
  [11155111, { networkName: 'Ethereum Sepolia', explorerUrl: 'https://sepolia.etherscan.io' }],
  [84532, { networkName: 'Base Sepolia', explorerUrl: 'https://sepolia.basescan.org' }],
  [421614, { networkName: 'Arbitrum Sepolia', explorerUrl: 'https://sepolia.arbiscan.io' }],
  [11155420, { networkName: 'OP Sepolia', explorerUrl: 'https://sepolia-optimism.etherscan.io' }],
  [80002, { networkName: 'Polygon Amoy', explorerUrl: 'https://amoy.polygonscan.com' }],
  [43113, { networkName: 'Avalanche Fuji', explorerUrl: 'https://testnet.snowtrace.io' }],
]);

export class EscrowVerificationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'EscrowVerificationError';
  }
}

function configuration() {
  const chainId = Number(process.env.STOCKPACT_TESTNET_CHAIN_ID ?? 84532);
  const network = testnets.get(chainId);
  const tokenDecimals = Number(process.env.STOCKPACT_TESTNET_TOKEN_DECIMALS ?? 6);
  const tokenSymbol = process.env.STOCKPACT_TESTNET_TOKEN_SYMBOL ?? 'TSTK';
  const confirmations = Number(process.env.STOCKPACT_TESTNET_CONFIRMATIONS ?? 2);
  try {
    const rpcUrl = new URL(process.env.STOCKPACT_TESTNET_RPC_URL ?? '');
    if (rpcUrl.protocol !== 'https:' || !network || !/^[A-Za-z0-9-]{1,12}$/.test(tokenSymbol) ||
        !Number.isInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error();
    toTokenUnits(1, tokenDecimals);
    const status: EscrowConfiguration = {
      mode: 'testnet', chainId, ...network, tokenDecimals, tokenSymbol, confirmations,
      contract: walletAddress(process.env.STOCKPACT_TESTNET_ESCROW_ADDRESS ?? ''),
      token: walletAddress(process.env.STOCKPACT_TESTNET_TOKEN_ADDRESS ?? ''),
    };
    return { status, rpcUrl: rpcUrl.href, attestor: privateKeyToAccount(bytes32(process.env.STOCKPACT_TESTNET_ATTESTOR_KEY ?? '')) };
  } catch {
    throw new EscrowVerificationError('Testnet escrow configuration is incomplete. Contact your StockPact administrator.', 503);
  }
}

export function escrowStatus(): EscrowStatus {
  const demo = process.env.STOCKPACT_DEMO === 'true' || (process.env.STOCKPACT_DEMO !== 'false' && process.env.NODE_ENV !== 'production');
  const mode = process.env.STOCKPACT_ESCROW_MODE ?? (demo ? 'demo' : 'disabled');
  if (mode === 'demo' || mode === 'disabled') return { mode };
  if (mode === 'testnet') return configuration().status;
  throw new EscrowVerificationError('StockPact escrow mode must be demo, disabled or testnet.', 503);
}

function requireConfiguration() {
  if (process.env.STOCKPACT_ESCROW_MODE !== 'testnet') throw new EscrowVerificationError('Testnet escrow is disabled.', 422);
  return configuration();
}

function signatureHex(signature: string): Hex {
  if (signature.length < 4 || signature.length > 2_048 || !isHex(signature, { strict: true })) throw new Error('Invalid wallet signature.');
  return signature;
}

export async function verifyWalletProof(input: WalletProof & { signature: string }): Promise<boolean> {
  const { status } = requireConfiguration();
  if (!(new Date(input.expiresAt).getTime() > Date.now())) return false;
  try {
    return await verifyMessage({ address: walletAddress(input.address), message: walletProofMessage(status, input), signature: signatureHex(input.signature) });
  } catch {
    return false;
  }
}

export async function verifyBuyerSignature(input: { authorization: EscrowAuthorization; buyerWallet: string; signature: string }): Promise<boolean> {
  const { status } = requireConfiguration();
  if (input.authorization.expiresAt * 1_000 <= Date.now()) return false;
  try {
    return await verifyTypedData({ address: walletAddress(input.buyerWallet), signature: signatureHex(input.signature), ...releaseTypedData(status, input.authorization) });
  } catch {
    return false;
  }
}

export async function attestRelease(input: {
  orderId: string;
  nonce: string;
  totalCents: number;
  amountCents?: number;
  totalQuantity: number;
  quantity: number;
  previousQuantity: number;
  expiresAt: string | number | Date;
  buyerWallet: string;
  supplierWallet: string;
}) {
  const { status, attestor } = requireConfiguration();
  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = typeof input.expiresAt === 'number' && input.expiresAt < 10_000_000_000
    ? Math.floor(input.expiresAt)
    : Math.floor(new Date(input.expiresAt).getTime() / 1_000);
  if (!(expiresAt > now && expiresAt <= now + 900)) throw new EscrowVerificationError('Release authorization must expire within 15 minutes.', 422);
  const amountCents = deliveryAmountCents(input.totalCents, input.totalQuantity, input.previousQuantity, input.quantity);
  if (amountCents <= 0 || (input.amountCents !== undefined && input.amountCents !== amountCents)) {
    throw new EscrowVerificationError('Release amount does not match the accepted terms.', 422);
  }
  const authorization: EscrowAuthorization = {
    orderId: escrowOrderReference(input.orderId, input.buyerWallet),
    nonce: bytes32(input.nonce),
    supplier: walletAddress(input.supplierWallet),
    previousQuantity: input.previousQuantity,
    quantity: input.quantity,
    amount: toTokenUnits(amountCents, status.tokenDecimals).toString(),
    expiresAt,
  };
  const platformSignature = await attestor.signTypedData(releaseTypedData(status, authorization));
  return { authorization, platformSignature };
}

function settlementClient() {
  const { status, rpcUrl, attestor } = requireConfiguration();
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 5_000, retryCount: 1 }) });
  return { status, client, attestor };
}

async function verifyEscrowDeployment({ status, client, attestor }: ReturnType<typeof settlementClient>) {
  const [chainId, token, unitsPerCent, onchainAttestor] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: status.contract, abi: escrowAbi, functionName: 'token' }),
    client.readContract({ address: status.contract, abi: escrowAbi, functionName: 'unitsPerCent' }),
    client.readContract({ address: status.contract, abi: escrowAbi, functionName: 'attestor' }),
  ]);
  if (chainId !== status.chainId || walletAddress(token) !== status.token ||
      unitsPerCent !== toTokenUnits(1, status.tokenDecimals) || walletAddress(onchainAttestor) !== walletAddress(attestor.address)) {
    throw new EscrowVerificationError('Configured testnet escrow does not match the deployed contract.', 503);
  }
}

async function confirmedReceipt(hash: string) {
  const settlement = settlementClient();
  const { status, client } = settlement;
  let transactionHash: Hex;
  try {
    transactionHash = bytes32(hash);
  } catch {
    throw new EscrowVerificationError('Enter a valid 32-byte testnet transaction hash.', 422);
  }
  try {
    const [receipt] = await Promise.all([
      client.getTransactionReceipt({ hash: transactionHash }),
      verifyEscrowDeployment(settlement),
    ]);
    if (receipt.status !== 'success') throw new EscrowVerificationError('The testnet transaction reverted. No settlement was recorded.', 422);
    const confirmations = await client.getTransactionConfirmations({ transactionReceipt: receipt });
    if (confirmations < status.confirmations) throw new EscrowVerificationError('Waiting for testnet confirmations. Retry with the same transaction hash.', 409);
    return { status, client, receipt, transactionHash, blockNumber: receipt.blockNumber.toString() };
  } catch (cause) {
    if (cause instanceof EscrowVerificationError) throw cause;
    if (cause instanceof TransactionReceiptNotFoundError) {
      throw new EscrowVerificationError('Transaction has not confirmed. Retry with the same transaction hash.', 409);
    }
    throw new EscrowVerificationError('Testnet confirmation is temporarily unavailable. Retry with the same transaction hash.', 503);
  }
}

export async function verifyRetiredRelease(authorization: EscrowAuthorization, buyerWallet: string) {
  const settlement = settlementClient();
  const { status, client } = settlement;
  const contract = { address: status.contract, abi: escrowAbi };
  try {
    const [head] = await Promise.all([client.getBlockNumber({ cacheTime: 0 }), verifyEscrowDeployment(settlement)]);
    const depth = BigInt(status.confirmations - 1);
    if (head < depth) throw new EscrowVerificationError('Wait for testnet confirmation before replacing this handover code.', 409);
    const blockNumber = head - depth;
    const [block, order, nonceUnavailable] = await Promise.all([
      client.getBlock({ blockNumber }),
      client.readContract({ ...contract, blockNumber, functionName: 'orders', args: [authorization.orderId] }),
      client.readContract({ ...contract, blockNumber, functionName: 'unavailableNonces', args: [authorization.orderId, authorization.nonce] }),
    ]);
    const [buyer, supplier, , , acceptedQuantity, , , , , , closed] = order;
    if (buyer.toLowerCase() !== walletAddress(buyerWallet) || supplier.toLowerCase() !== walletAddress(authorization.supplier)) {
      throw new EscrowVerificationError('The on-chain escrow does not match this handover.', 422);
    }
    if (acceptedQuantity !== BigInt(authorization.previousQuantity)) {
      throw new EscrowVerificationError('Escrow has already advanced on chain. Confirm the original transaction hash before replacing this code.', 409);
    }
    if (closed) throw new EscrowVerificationError('Escrow is closed on chain. Reconcile the closing transaction before replacing this code.', 409);
    if (!nonceUnavailable && block.timestamp < BigInt(authorization.expiresAt)) {
      throw new EscrowVerificationError('Wait for the signed handover code to expire on chain, or revoke its nonce in the escrow contract.', 409);
    }
    return { blockNumber: blockNumber.toString(), status: nonceUnavailable ? 'cancelled' as const : 'expired' as const };
  } catch (cause) {
    if (cause instanceof EscrowVerificationError) throw cause;
    throw new EscrowVerificationError('Testnet confirmation is temporarily unavailable. Try replacing this code again.', 503);
  }
}

export async function verifyFunding(input: FundingTerms & { hash: string }) {
  const { status, receipt, transactionHash, blockNumber } = await confirmedReceipt(input.hash);
  const orderId = escrowOrderReference(input.orderId, input.buyerWallet);
  const amount = toTokenUnits(input.amountCents, status.tokenDecimals);
  const quantity = positiveInteger(input.quantity, 'Order quantity');
  const buyer = walletAddress(input.buyerWallet);
  const supplier = walletAddress(input.supplierWallet);
  const events = parseEventLogs({ abi: escrowAbi, eventName: 'Funded', logs: receipt.logs.filter((log) => log.address.toLowerCase() === status.contract) });
  if (!events.some(({ args }) => args.orderId === orderId && args.buyer.toLowerCase() === buyer && args.supplier.toLowerCase() === supplier &&
      args.amount === amount && args.quantity === quantity)) {
    throw new EscrowVerificationError('No confirmed funding event matches this order and its accepted terms.', 422);
  }
  return { transactionHash, blockNumber };
}

export async function verifyRelease(input: {
  orderId: string;
  hash: string;
  nonce: string;
  amountCents: number;
  previousQuantity: number;
  quantity: number;
  buyerWallet: string;
  supplierWallet: string;
}) {
  const { status, receipt, transactionHash, blockNumber } = await confirmedReceipt(input.hash);
  const orderId = escrowOrderReference(input.orderId, input.buyerWallet);
  const nonce = bytes32(input.nonce);
  const supplier = walletAddress(input.supplierWallet);
  const previousQuantity = BigInt(input.previousQuantity);
  const quantity = positiveInteger(input.quantity, 'Delivery quantity');
  const amount = toTokenUnits(input.amountCents, status.tokenDecimals);
  const events = parseEventLogs({ abi: escrowAbi, eventName: 'Released', logs: receipt.logs.filter((log) => log.address.toLowerCase() === status.contract) });
  const settlement = events.find(({ args }) => args.orderId === orderId && args.nonce === nonce && args.supplier.toLowerCase() === supplier &&
    args.previousQuantity === previousQuantity && args.quantity === quantity && args.amount === amount);
  if (!settlement) throw new EscrowVerificationError('No confirmed release matches this delivery authorization.', 422);
  return { transactionHash, blockNumber, submittedBy: settlement.args.submittedBy };
}

export async function verifyDriverAssignment(input: {
  orderId: string;
  hash: string;
  buyerWallet: string;
  supplierWallet: string;
  driverWallet: string;
}) {
  const { status, client, receipt, transactionHash, blockNumber } = await confirmedReceipt(input.hash);
  const orderId = escrowOrderReference(input.orderId, input.buyerWallet);
  const supplier = walletAddress(input.supplierWallet);
  const driver = walletAddress(input.driverWallet);
  const events = parseEventLogs({ abi: escrowAbi, eventName: 'DriverSet', logs: receipt.logs.filter((log) => log.address.toLowerCase() === status.contract) });
  if (!events.some(({ args }) => args.orderId === orderId && args.driver.toLowerCase() === driver)) {
    throw new EscrowVerificationError('No confirmed driver assignment matches this order.', 422);
  }
  const [, currentSupplier, currentDriver] = await client.readContract({ address: status.contract, abi: escrowAbi, functionName: 'orders', args: [orderId] });
  if (walletAddress(currentSupplier) !== supplier || currentDriver.toLowerCase() !== driver) {
    throw new EscrowVerificationError('The on-chain driver assignment has changed.', 422);
  }
  return { transactionHash, blockNumber };
}

export { deliveryAmountCents, type EscrowAuthorization, type EscrowStatus, type WalletProof };
