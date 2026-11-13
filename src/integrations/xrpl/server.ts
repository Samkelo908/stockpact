import { createHash } from 'node:crypto';
import { decode, hashes, isValidClassicAddress, Wallet, type Payment } from 'xrpl';
import { z } from 'zod';

const testnetRpc = 'https://s.altnet.rippletest.net:51234/';
const explorerUrl = 'https://testnet.xrpl.org';
const testnetId = 1;
const ledgerWindow = 12;
const maxFeeDrops = 1000n;
const hardPaymentCap = 5_000_000n;
const hexHash = /^[A-F0-9]{64}$/i;
const dropsPattern = /^[1-9][0-9]{0,7}$/;
const publicMemoType = Buffer.from('stockpact:payment-intent:v1').toString('hex').toUpperCase();

export type XrplStatus = { mode: 'disabled' } | {
  mode: 'testnet'; network: 'XRPL Testnet'; account: string; recipient: string; destinationTag?: number;
  maxPaymentDrops: string; explorerUrl: string;
};

export type XrplPaymentIntent = {
  intentId: string; orderId: string; recipient: string; drops: string;
  purpose: 'supplier_release'; destinationTag?: number;
};

export type SignedXrplPayment = {
  hash: string; blob: string; account: string; destination: string; destinationTag?: number;
  drops: string; feeDrops: string; intentMemo: string; sequence: number; firstLedgerSequence: number; lastLedgerSequence: number;
};

export type XrplPaymentResult = {
  status: 'pending' | 'confirmed' | 'failed' | 'expired'; hash: string; ledgerIndex?: number; engineResult?: string;
};

export class XrplPolicyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'XrplPolicyError';
  }
}

function signerConfiguration() {
  const seed = process.env.STOCKPACT_XRPL_TESTNET_SEED;
  const account = process.env.STOCKPACT_XRPL_TESTNET_ACCOUNT;
  const recipient = process.env.STOCKPACT_XRPL_TESTNET_RECIPIENT;
  const tag = process.env.STOCKPACT_XRPL_TESTNET_DESTINATION_TAG?.trim();
  const maxPaymentDrops = process.env.STOCKPACT_XRPL_MAX_PAYMENT_DROPS?.trim() || '1000000';
  if (process.env.STOCKPACT_XRPL_ENABLED !== 'true' || !seed || !account || !recipient || account === recipient ||
      !isValidClassicAddress(account) || !isValidClassicAddress(recipient) || !dropsPattern.test(maxPaymentDrops) ||
      BigInt(maxPaymentDrops) > hardPaymentCap || (tag && (!/^\d{1,10}$/.test(tag) || Number(tag) > 0xFFFFFFFF))) return null;

  try {
    const wallet = Wallet.fromSeed(seed);
    if (wallet.address !== account) return null;
    return {
      wallet,
      status: { mode: 'testnet', network: 'XRPL Testnet', account, recipient,
        destinationTag: tag ? Number(tag) : undefined, maxPaymentDrops, explorerUrl } as const,
    };
  } catch {
    return null;
  }
}

export function xrplStatus(): XrplStatus {
  return signerConfiguration()?.status ?? { mode: 'disabled' };
}

function requireConfiguration() {
  const config = signerConfiguration();
  if (!config) throw new XrplPolicyError('XRPL Testnet signing is unavailable in this workspace.', 503);
  return config;
}

const ledgerSequence = z.number().int().min(1).max(0xFFFFFFFF);
const methodResult = z.object({ result: z.record(z.string(), z.unknown()) });
const serverInfo = z.object({ info: z.object({
  network_id: z.literal(testnetId),
  validated_ledger: z.object({ seq: ledgerSequence, age: z.number().nonnegative().max(60) }),
}) });
const accountInfo = z.object({ validated: z.literal(true), account_data: z.object({ Account: z.string(), Sequence: ledgerSequence }) });
const feeInfo = z.object({ drops: z.object({ open_ledger_fee: z.string().regex(/^\d{1,9}$/), minimum_fee: z.string().regex(/^\d{1,9}$/) }) });
const receiptResult = z.object({
  validated: z.literal(true), hash: z.string().regex(hexHash), ledger_index: ledgerSequence,
  meta: z.object({ TransactionResult: z.string(), delivered_amount: z.unknown().optional() }),
  tx_json: z.record(z.string(), z.unknown()),
});

async function rpc(method: 'server_info' | 'account_info' | 'fee' | 'submit' | 'tx', fields = {}) {
  try {
    const response = await fetch(testnetRpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params: [{ api_version: 2, ...fields }] }),
      signal: AbortSignal.timeout(8_000), cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error();
    return methodResult.parse(await response.json()).result;
  } catch {
    throw new XrplPolicyError('XRPL Testnet is temporarily unavailable.', 503);
  }
}

async function validatedLedger() {
  const parsed = serverInfo.safeParse(await rpc('server_info'));
  if (!parsed.success) throw new XrplPolicyError('The server did not identify a current validated XRPL Testnet ledger.', 503);
  return parsed.data.info.validated_ledger.seq;
}

function memoFor(intent: XrplPaymentIntent) {
  return createHash('sha256').update(JSON.stringify(['stockpact:xrpl-testnet:v1', intent.purpose, intent.intentId, intent.orderId,
    intent.recipient, intent.destinationTag ?? null, intent.drops])).digest('hex').toUpperCase();
}

function matchesPayment(transaction: Record<string, unknown>, signed: SignedXrplPayment) {
  const memo = z.array(z.object({ Memo: z.object({ MemoType: z.string(), MemoData: z.string() }) })).length(1)
    .safeParse(transaction.Memos);
  return transaction.TransactionType === 'Payment' && transaction.Account === signed.account &&
    transaction.Destination === signed.destination && transaction.DestinationTag === signed.destinationTag &&
    (transaction.Amount ?? transaction.DeliverMax) === signed.drops && transaction.Fee === signed.feeDrops &&
    transaction.Sequence === signed.sequence && transaction.LastLedgerSequence === signed.lastLedgerSequence &&
    (transaction.Flags === undefined || transaction.Flags === 0 || transaction.Flags === 0x80000000) &&
    transaction.NetworkID === undefined && transaction.SendMax === undefined && transaction.DeliverMin === undefined &&
    transaction.Paths === undefined && transaction.TicketSequence === undefined && transaction.Signers === undefined &&
    transaction.Delegate === undefined && transaction.Sponsor === undefined && memo.success &&
    memo.data[0].Memo.MemoType.toUpperCase() === publicMemoType && memo.data[0].Memo.MemoData.toUpperCase() === signed.intentMemo;
}

export async function prepareXrplPayment(input: XrplPaymentIntent): Promise<SignedXrplPayment> {
  const { status, wallet } = requireConfiguration();
  const id = /^[a-zA-Z0-9:_-]{1,128}$/;
  if (input.purpose !== 'supplier_release' || !id.test(input.intentId) || !id.test(input.orderId) ||
      input.recipient !== status.recipient || input.destinationTag !== status.destinationTag ||
      !dropsPattern.test(input.drops) || BigInt(input.drops) > BigInt(status.maxPaymentDrops)) {
    throw new XrplPolicyError('XRPL payment terms exceed the configured testnet signing policy.', 422);
  }
  const validated = await validatedLedger();
  const [account, fees] = await Promise.all([
    rpc('account_info', { account: status.account, ledger_index: validated }),
    rpc('fee'),
  ]);
  const parsedAccount = accountInfo.safeParse(account);
  const parsedFee = feeInfo.safeParse(fees);
  if (!parsedAccount.success || parsedAccount.data.account_data.Account !== status.account || !parsedFee.success) {
    throw new XrplPolicyError('The configured XRPL Testnet account or fee could not be verified.', 503);
  }
  const { open_ledger_fee, minimum_fee } = parsedFee.data.drops;
  const fee = BigInt(open_ledger_fee) >= BigInt(minimum_fee) ? BigInt(open_ledger_fee) : BigInt(minimum_fee);
  if (fee <= 0n || fee > maxFeeDrops) throw new XrplPolicyError('The XRP Testnet fee exceeds the signing policy. Try again shortly.', 503);

  const intentMemo = memoFor(input);
  const firstLedgerSequence = validated + 1;
  const lastLedgerSequence = validated + ledgerWindow;
  const sequence = parsedAccount.data.account_data.Sequence;
  const transaction: Payment = {
    TransactionType: 'Payment', Account: status.account, Destination: input.recipient, Amount: input.drops,
    DestinationTag: status.destinationTag, Fee: fee.toString(), Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence, Memos: [{ Memo: { MemoType: publicMemoType, MemoData: intentMemo } }],
  };
  const signed = wallet.sign(transaction);
  return {
    hash: signed.hash, blob: signed.tx_blob, account: status.account, destination: input.recipient, destinationTag: status.destinationTag,
    drops: input.drops, feeDrops: fee.toString(), intentMemo, sequence, firstLedgerSequence, lastLedgerSequence,
  };
}

function validatePersistedPayment(signed: SignedXrplPayment) {
  if (!hexHash.test(signed.hash) || !hexHash.test(signed.intentMemo) || !/^(?:[a-f\d]{2}){1,2048}$/i.test(signed.blob) ||
      !ledgerSequence.safeParse(signed.firstLedgerSequence).success || !ledgerSequence.safeParse(signed.sequence).success ||
      !ledgerSequence.safeParse(signed.lastLedgerSequence).success || signed.lastLedgerSequence - signed.firstLedgerSequence !== ledgerWindow - 1 ||
      !dropsPattern.test(signed.drops) || BigInt(signed.drops) > hardPaymentCap || !dropsPattern.test(signed.feeDrops) ||
      BigInt(signed.feeDrops) > maxFeeDrops || !isValidClassicAddress(signed.account) || !isValidClassicAddress(signed.destination)) {
    throw new XrplPolicyError('The saved XRP payment is invalid.', 422);
  }
  try {
    if (hashes.hashSignedTx(signed.blob).toUpperCase() !== signed.hash.toUpperCase() || !matchesPayment(decode(signed.blob), signed)) throw new Error();
  } catch {
    throw new XrplPolicyError('The saved XRP payment does not match its signed terms.', 422);
  }
}

/** Persist the signed blob and its hash before calling submit. */
export async function submitXrplPayment(signed: SignedXrplPayment): Promise<XrplPaymentResult> {
  const { status, wallet } = requireConfiguration();
  validatePersistedPayment(signed);
  if (signed.account !== status.account || signed.destination !== status.recipient || signed.destinationTag !== status.destinationTag ||
      BigInt(signed.drops) > BigInt(status.maxPaymentDrops) || !wallet.verifyTransaction(signed.blob)) {
    throw new XrplPolicyError('The saved XRP payment is outside the current signing policy.', 422);
  }
  const head = await validatedLedger();
  if (head >= signed.lastLedgerSequence) return confirmXrplPayment(signed);
  try {
    const response = await rpc('submit', { tx_blob: signed.blob, fail_hard: true });
    return { status: 'pending', hash: signed.hash, engineResult: typeof response.engine_result === 'string' ? response.engine_result : undefined };
  } catch {
    // A timeout after broadcast has an unknown result. The caller keeps this exact blob and hash.
    return { status: 'pending', hash: signed.hash };
  }
}

export async function confirmXrplPayment(signed: SignedXrplPayment): Promise<XrplPaymentResult> {
  validatePersistedPayment(signed);
  const head = await validatedLedger();
  const result = await rpc('tx', { transaction: signed.hash, min_ledger: signed.firstLedgerSequence,
    max_ledger: signed.lastLedgerSequence, binary: false });
  if (result.error === 'txnNotFound') {
    return { status: head >= signed.lastLedgerSequence && result.searched_all === true ? 'expired' : 'pending', hash: signed.hash };
  }
  if (result.error) throw new XrplPolicyError('The XRPL Testnet receipt could not be checked.', 503);
  if (result.validated !== true) return { status: 'pending', hash: signed.hash };

  const parsed = receiptResult.safeParse(result);
  if (!parsed.success) throw new XrplPolicyError('The validated XRP receipt was incomplete.', 503);
  const receipt = parsed.data;
  if (receipt.hash.toUpperCase() !== signed.hash.toUpperCase() || receipt.ledger_index < signed.firstLedgerSequence ||
      receipt.ledger_index > signed.lastLedgerSequence || !matchesPayment(receipt.tx_json, signed)) {
    throw new XrplPolicyError('The validated XRP receipt does not match the saved payment.', 503);
  }
  const engineResult = receipt.meta.TransactionResult;
  if (engineResult === 'tesSUCCESS' && receipt.meta.delivered_amount !== signed.drops) {
    throw new XrplPolicyError('The XRP receipt did not deliver the authorised amount.', 503);
  }
  return { status: engineResult === 'tesSUCCESS' ? 'confirmed' : 'failed', hash: signed.hash, ledgerIndex: receipt.ledger_index, engineResult };
}
