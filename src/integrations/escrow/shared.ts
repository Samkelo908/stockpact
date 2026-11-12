import { encodeAbiParameters, isAddress, isHex, keccak256, parseAbi, stringToHex, type Address, type Hex } from 'viem';

export type EscrowConfiguration = {
  mode: 'testnet';
  chainId: number;
  networkName: string;
  explorerUrl: string;
  contract: Address;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  confirmations: number;
};

export type EscrowStatus = { mode: 'demo' } | EscrowConfiguration;

export type WalletProof = {
  address: string;
  companyId: string;
  userId: string;
  challenge: string;
  expiresAt: string | number | Date;
};

export type EscrowAuthorization = {
  orderId: Hex;
  nonce: Hex;
  supplier: Address;
  previousQuantity: number;
  quantity: number;
  amount: string;
  expiresAt: number;
};

export type FundingTerms = {
  orderId: string;
  buyerWallet: string;
  supplierWallet: string;
  amountCents: number;
  quantity: number;
};

export const escrowAbi = parseAbi([
  'struct DeliveryRelease { bytes32 orderId; bytes32 nonce; address supplier; uint64 previousQuantity; uint64 quantity; uint256 amount; uint64 expiresAt; }',
  'function fund(bytes32 orderKey, address supplier, uint64 quantity, uint256 amount)',
  'function release(DeliveryRelease authorization, bytes buyerSignature, bytes platformSignature)',
  'function setDriver(bytes32 orderId, address driver)',
  'function cancelAuthorization(bytes32 orderId, bytes32 nonce)',
  'function openDispute(bytes32 orderId)',
  'function resolveDispute(bytes32 orderId, uint256 supplierAward)',
  'function refundExpired(bytes32 orderId)',
  'function token() view returns (address)',
  'function unitsPerCent() view returns (uint256)',
  'function attestor() view returns (address)',
  'function orders(bytes32 orderId) view returns (address buyer, address supplier, address driver, uint64 quantity, uint64 acceptedQuantity, uint64 refundAvailableAt, uint64 disputedAt, uint256 funded, uint256 released, uint256 refunded, bool closed)',
  'event Funded(bytes32 indexed orderId, address indexed buyer, address indexed supplier, uint256 amount, uint64 quantity)',
  'event Released(bytes32 indexed orderId, bytes32 indexed nonce, address indexed supplier, address submittedBy, uint64 previousQuantity, uint64 quantity, uint256 amount)',
  'event DriverSet(bytes32 indexed orderId, address indexed driver)',
  'event AuthorizationCancelled(bytes32 indexed orderId, bytes32 indexed nonce)',
  'event Disputed(bytes32 indexed orderId, address indexed openedBy)',
  'event Closed(bytes32 indexed orderId, uint256 paidToSupplier, uint256 refundedToBuyer)',
]);

export function positiveInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive whole number.`);
  return BigInt(value);
}

function nonnegativeInteger(value: number, label: string): bigint {
  return value === 0 ? 0n : positiveInteger(value, label);
}

export function walletAddress(value: string): Address {
  if (!isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) throw new Error('A valid wallet address is required.');
  return value.toLowerCase() as Address;
}

export function bytes32(value: string): Hex {
  if (!isHex(value, { strict: true }) || value.length !== 66) throw new Error('Expected a 32-byte hexadecimal value.');
  return value.toLowerCase() as Hex;
}

export function toTokenUnits(amountCents: number, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 18) throw new Error('Unsupported token decimals.');
  return nonnegativeInteger(amountCents, 'Amount') * 10n ** BigInt(decimals - 2);
}

/** Allocate any rounding residual to the final accepted delivery. */
export function deliveryAmountCents(totalCents: number, totalQuantity: number, previousQuantity: number, quantity: number): number {
  const funded = positiveInteger(totalCents, 'Total');
  const units = positiveInteger(totalQuantity, 'Order quantity');
  const before = nonnegativeInteger(previousQuantity, 'Previously accepted quantity');
  const after = before + positiveInteger(quantity, 'Delivery quantity');
  if (after > units) throw new Error('Delivery exceeds the remaining order quantity.');
  return Number((funded * after) / units - (funded * before) / units);
}

export function orderKey(orderId: string): Hex {
  if (typeof orderId !== 'string' || orderId.length < 1 || orderId.length > 128) throw new Error('Invalid order ID.');
  return keccak256(stringToHex(orderId));
}

export function escrowOrderReference(orderId: string, buyerWallet: string): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [orderKey(orderId), walletAddress(buyerWallet)]));
}

export function walletProofMessage(config: EscrowConfiguration, proof: WalletProof): string {
  return [
    'StockPact testnet wallet registration',
    `Wallet: ${walletAddress(proof.address)}`,
    `Company: ${proof.companyId}`,
    `User: ${proof.userId}`,
    `Chain: ${config.chainId}`,
    `Contract: ${config.contract}`,
    `Challenge: ${proof.challenge}`,
    `Expires: ${new Date(proof.expiresAt).toISOString()}`,
  ].join('\n');
}

export function releaseMessage(authorization: EscrowAuthorization) {
  if (!/^[1-9]\d{0,77}$/.test(authorization.amount)) throw new Error('Invalid token amount.');
  return {
    orderId: bytes32(authorization.orderId),
    nonce: bytes32(authorization.nonce),
    supplier: walletAddress(authorization.supplier),
    previousQuantity: nonnegativeInteger(authorization.previousQuantity, 'Previously accepted quantity'),
    quantity: positiveInteger(authorization.quantity, 'Delivery quantity'),
    amount: BigInt(authorization.amount),
    expiresAt: positiveInteger(authorization.expiresAt, 'Expiration'),
  };
}

export function releaseTypedData(config: EscrowConfiguration, authorization: EscrowAuthorization) {
  return {
    domain: { name: 'StockPact Escrow', version: '1', chainId: config.chainId, verifyingContract: config.contract },
    primaryType: 'DeliveryRelease',
    types: {
      DeliveryRelease: [
        { name: 'orderId', type: 'bytes32' },
        { name: 'nonce', type: 'bytes32' },
        { name: 'supplier', type: 'address' },
        { name: 'previousQuantity', type: 'uint64' },
        { name: 'quantity', type: 'uint64' },
        { name: 'amount', type: 'uint256' },
        { name: 'expiresAt', type: 'uint64' },
      ],
    },
    message: releaseMessage(authorization),
  } as const;
}
