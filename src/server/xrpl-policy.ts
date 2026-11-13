import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { deliveryAmountCents } from '../integrations/escrow/shared';
import { xrplStatus } from '../integrations/xrpl/server';
import type { Actor, Company, Order } from '../shared/marketplace';
import { xrplTestDropsPerZarCent, type XrplAttempt, type XrplMandate, type XrplState } from '../shared/xrpl';
import { actorCompany, audit, MarketplaceError, orderScope, requireFound, requireRole } from './access';
import { getDb, record, save, tables, type DbSession } from './db';
import { id, parse } from './inputs';

type DateValue = Date | string;
export type MandateRow = {
  id: string; buyer_id: string; supplier_id: string; recipient: string; destination_tag: number | null;
  max_drops: string; total_drops: string; used_drops: string; reserved_drops: string; paused: boolean;
  created_at: DateValue; updated_at: DateValue;
};

export type AttemptRow = {
  id: string; order_id: string; source_id: string; mandate_id: string; buyer_id: string; supplier_id: string;
  recipient: string; destination_tag: number | null; amount_drops: string; amount_cents: string; quantity: number;
  status: XrplAttempt['status']; reason: string | null; tx_hash: string | null; ledger_index: number | null;
  created_at: DateValue; updated_at: DateValue;
};

export interface XrplEvidence {
  attemptId: string;
  orderId: string;
  sourceId: string;
  supplierId: string;
  acceptedQuantity: number;
  quoteAmountCents: number;
  drops: string;
  mandateId: string;
}

export type XrplDecisionProvider = (evidence: Readonly<XrplEvidence>) => Promise<{ requestPayment: boolean; reason: string }>;

type XrplOrder = Order & { xrplMandateId?: string };
type Handover = { supplierId: string; orderId: string; quantity: number; amountCents: number; status: string; previousQuantity: number };
type EnabledConfig = Extract<ReturnType<typeof xrplStatus>, { mode: 'testnet' }> & { supplierId: string };

const xrplAddress = z.string().trim().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'Enter a classic XRPL Testnet address.');
const tag = z.number().int().min(0).max(4_294_967_295).optional();
const drops = z.string().regex(/^[1-9][0-9]{0,12}$/, 'Use a whole number of drops.');
const iso = (date: DateValue) => new Date(date).toISOString();

export const mandateColumns = sql`id, buyer_id, supplier_id, recipient, destination_tag::float8 as destination_tag,
  max_drops::text as max_drops, total_drops::text as total_drops, used_drops::text as used_drops,
  reserved_drops::text as reserved_drops, paused, created_at, updated_at`;
export const attemptColumns = sql`id, order_id, source_id, mandate_id, buyer_id, supplier_id, recipient,
  destination_tag::float8 as destination_tag, amount_drops::text as amount_drops, amount_cents::text as amount_cents,
  quantity, status, reason, tx_hash, ledger_index::float8 as ledger_index, created_at, updated_at`;

function publicMandate(row: MandateRow): XrplMandate {
  return { id: row.id, supplierId: row.supplier_id, recipient: row.recipient, destinationTag: row.destination_tag ?? undefined,
    maxDrops: row.max_drops, totalDrops: row.total_drops, usedDrops: row.used_drops, reservedDrops: row.reserved_drops,
    paused: row.paused, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export function publicAttempt(row: AttemptRow): XrplAttempt {
  return { id: row.id, orderId: row.order_id, sourceId: row.source_id, mandateId: row.mandate_id, recipient: row.recipient,
    destinationTag: row.destination_tag ?? undefined, drops: row.amount_drops, status: row.status,
    hash: row.tx_hash ?? undefined, ledgerIndex: row.ledger_index ?? undefined, reason: row.reason ?? undefined,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export function enabledXrpl(): EnabledConfig {
  try {
    const config = xrplStatus();
    const supplierId = process.env.STOCKPACT_XRPL_TESTNET_SUPPLIER_ID?.trim();
    if (config.mode === 'testnet' && supplierId && /^[a-zA-Z0-9:_-]{1,120}$/.test(supplierId)) return { ...config, supplierId };
  } catch {
    // A partially configured XRPL service stays unavailable to marketplace actions.
  }
  throw new MarketplaceError('XRPL Testnet payment signing is unavailable.', 503);
}

export async function getXrplState(actor: Actor | null): Promise<XrplState> {
  const enabled = Boolean(actor?.demoRole) && process.env.STOCKPACT_XRPL_ENABLED === 'true';
  const state: XrplState = { enabled, configured: false, mode: 'disabled', dropsPerZarCent: xrplTestDropsPerZarCent, mandates: [], attempts: [] };
  if (!actor?.demoRole) return state;
  if (enabled) {
    try { Object.assign(state, enabledXrpl(), { configured: true }); }
    catch { state.mode = 'testnet'; }
  }
  const db = await getDb();
  const owner = actor.role === 'owner';
  const canSeeOrders = actor.role !== 'reviewer' && actor.role !== 'driver';
  const [mandates, attempts] = await Promise.all([
    owner ? sql<MandateRow>`select ${mandateColumns} from xrpl_mandates where buyer_id = ${actor.companyId} order by created_at desc limit 100`.execute(db) : null,
    sql<AttemptRow>`select ${attemptColumns} from xrpl_payment_attempts where ${canSeeOrders}
      and order_id in (select id from orders where ${orderScope(actor)})
      order by created_at desc limit 120`.execute(db),
  ]);
  return { ...state, mandates: mandates?.rows.map(publicMandate) ?? [], attempts: attempts.rows.map(publicAttempt) };
}

function assertDestination(config: EnabledConfig, supplierId: string, recipient: string, destinationTag?: number) {
  if (supplierId !== config.supplierId || recipient !== config.recipient || destinationTag !== config.destinationTag) {
    throw new MarketplaceError('The supplier, address and tag must match the configured XRPL Testnet recipient.', 422);
  }
}

async function requireVerifiedPair(db: DbSession, buyerId: string, supplierId: string) {
  const buyer = requireFound(await record<Company>(db, tables.companies, buyerId), 'Buyer company was not found.');
  const supplier = requireFound(await record<Company>(db, tables.companies, supplierId), 'Supplier company was not found.');
  if (buyerId === supplierId || !buyer.demo || !supplier.demo || !buyer.capabilities.includes('buyer') ||
      buyer.verification.business !== 'verified' || buyer.verification.representative !== 'verified' ||
      supplier.verification.business !== 'verified' || !supplier.capabilities.includes('supplier')) {
    throw new MarketplaceError('An approved buyer and a verified supplier from the same workspace are required.', 403);
  }
  return { buyer, supplier };
}

async function requireDemoOwner(db: DbSession, actor: Actor) {
  requireRole(actor, 'owner');
  if (!actor.demoRole) throw new MarketplaceError('XRPL Testnet autopay is available in the fictional workspace.', 403);
  return actorCompany(actor, db);
}

export async function findMandate(db: DbSession, mandateId: string) {
  return (await sql<MandateRow>`select ${mandateColumns} from xrpl_mandates where id = ${mandateId}`.execute(db)).rows[0];
}

export async function upsertXrplMandate(db: DbSession, actor: Actor, input: unknown): Promise<XrplMandate> {
  await requireDemoOwner(db, actor);
  const config = enabledXrpl();
  const values = parse(z.object({ supplierId: id, recipient: xrplAddress, destinationTag: tag, maxDrops: drops, totalDrops: drops }), input);
  assertDestination(config, values.supplierId, values.recipient, values.destinationTag);
  await requireVerifiedPair(db, actor.companyId, values.supplierId);
  if (BigInt(values.maxDrops) > BigInt(config.maxPaymentDrops) || BigInt(values.maxDrops) > BigInt(values.totalDrops)) {
    throw new MarketplaceError('The per-payment cap must fit the mandate total and configured signer cap.', 422);
  }
  const existing = (await sql<MandateRow>`select ${mandateColumns} from xrpl_mandates
    where buyer_id = ${actor.companyId} and supplier_id = ${values.supplierId}`.execute(db)).rows[0];
  if (existing && (existing.recipient !== values.recipient || (existing.destination_tag ?? undefined) !== values.destinationTag)) {
    throw new MarketplaceError('The address on an existing mandate cannot be replaced.', 409);
  }
  if (existing && BigInt(values.totalDrops) < BigInt(existing.used_drops) + BigInt(existing.reserved_drops)) {
    throw new MarketplaceError('The total cap cannot be lower than spent and reserved XRP.', 422);
  }
  const result = await sql<MandateRow>`insert into xrpl_mandates (id, buyer_id, supplier_id, recipient, destination_tag, max_drops, total_drops)
    values (${existing?.id ?? randomUUID()}, ${actor.companyId}, ${values.supplierId}, ${values.recipient}, ${values.destinationTag ?? null}, ${values.maxDrops}, ${values.totalDrops})
    on conflict (buyer_id, supplier_id) do update set max_drops = excluded.max_drops, total_drops = excluded.total_drops, updated_at = now()
    returning ${mandateColumns}`.execute(db);
  await audit(db, actor, existing ? 'xrpl_mandate_updated' : 'xrpl_mandate_created', result.rows[0].id, {
    supplierId: values.supplierId, recipient: values.recipient, destinationTag: values.destinationTag, maxDrops: values.maxDrops, totalDrops: values.totalDrops,
  });
  return publicMandate(result.rows[0]);
}

export async function pauseXrplMandate(db: DbSession, actor: Actor, input: unknown): Promise<XrplMandate> {
  await requireDemoOwner(db, actor);
  const { mandateId, paused } = parse(z.object({ mandateId: id, paused: z.boolean() }), input);
  const result = await sql<MandateRow>`update xrpl_mandates set paused = ${paused}, updated_at = now()
    where id = ${mandateId} and buyer_id = ${actor.companyId} returning ${mandateColumns}`.execute(db);
  const mandate = requireFound(result.rows[0], 'XRPL mandate was not found.');
  await audit(db, actor, paused ? 'xrpl_mandate_paused' : 'xrpl_mandate_resumed', mandateId);
  return publicMandate(mandate);
}

export async function ensureXrplOrderMandate(db: DbSession, actor: Actor, order: Order): Promise<string> {
  await requireDemoOwner(db, actor);
  if (actor.companyId !== order.buyerId) throw new MarketplaceError('Only the buyer owner can select XRPL Testnet payments.', 403);
  const config = enabledXrpl();
  await requireVerifiedPair(db, order.buyerId, order.supplierId);
  if ((order.currency ?? 'ZAR') !== 'ZAR') throw new MarketplaceError('The test drops conversion applies to ZAR orders only.', 422);
  const match = await sql<MandateRow>`select ${mandateColumns} from xrpl_mandates
    where buyer_id = ${order.buyerId} and supplier_id = ${order.supplierId}`.execute(db);
  const mandate = requireFound(match.rows[0], 'Create a mandate for this supplier before selecting XRPL Testnet payments.');
  if (mandate.paused) throw new MarketplaceError('Resume the supplier mandate before selecting XRPL Testnet payments.', 409);
  assertDestination(config, mandate.supplier_id, mandate.recipient, mandate.destination_tag ?? undefined);
  return mandate.id;
}

function readSource(order: XrplOrder, handover: Handover, orderId: string) {
  if ((order.currency ?? 'ZAR') !== 'ZAR' || !order.xrplMandateId || handover.status !== 'redeemed' || handover.orderId !== orderId ||
      handover.supplierId !== order.supplierId || order.acceptedQuantity < handover.previousQuantity + handover.quantity) {
    throw new MarketplaceError('The XRPL payment does not have matching handover evidence.', 409);
  }
  const amountCents = deliveryAmountCents(order.totalCents, order.quantity, handover.previousQuantity, handover.quantity);
  if (handover.amountCents !== amountCents || amountCents <= 0) throw new MarketplaceError('The accepted quote and handover amounts do not match.', 409);
  return { amountCents, amountDrops: (BigInt(amountCents) * BigInt(xrplTestDropsPerZarCent)).toString(), mandateId: order.xrplMandateId };
}

export async function stageXrplIntent(db: DbSession, orderId: string, sourceId: string): Promise<XrplAttempt | null> {
  const order = requireFound(await record<XrplOrder>(db, tables.orders, orderId));
  if (order.paymentMode !== 'xrpl') return null;
  const existing = (await sql<AttemptRow>`select ${attemptColumns} from xrpl_payment_attempts where source_id = ${sourceId}`.execute(db)).rows[0];
  if (existing) {
    if (existing.order_id !== orderId) throw new MarketplaceError('The handover belongs to another order.', 409);
    return publicAttempt(existing);
  }
  const handover = requireFound(await record<Handover>(db, tables.qr, sourceId));
  const { amountCents, amountDrops, mandateId } = readSource(order, handover, orderId);
  const mandate = requireFound(await findMandate(db, mandateId));
  if (mandate.buyer_id !== order.buyerId || mandate.supplier_id !== order.supplierId) throw new MarketplaceError('The order mandate is unavailable.', 409);
  const attempt = await sql<AttemptRow>`insert into xrpl_payment_attempts
    (id, order_id, source_id, mandate_id, buyer_id, supplier_id, recipient, destination_tag, amount_drops, amount_cents, quantity, status)
    values (${randomUUID()}, ${orderId}, ${sourceId}, ${mandateId}, ${order.buyerId}, ${order.supplierId}, ${mandate.recipient},
      ${mandate.destination_tag}, ${amountDrops}, ${amountCents}, ${handover.quantity}, 'queued') returning ${attemptColumns}`.execute(db);
  await auditXrpl(db, attempt.rows[0], 'xrpl_intent_queued');
  return publicAttempt(attempt.rows[0]);
}

export async function verifyXrplEvidence(db: DbSession, attempt: AttemptRow) {
  const order = requireFound(await record<XrplOrder>(db, tables.orders, attempt.order_id));
  const handover = requireFound(await record<Handover>(db, tables.qr, attempt.source_id));
  const mandate = requireFound(await findMandate(db, attempt.mandate_id));
  const source = readSource(order, handover, attempt.order_id);
  if (order.paymentMode !== 'xrpl' || order.status === 'disputed' || order.status === 'cancelled' ||
      order.buyerId !== attempt.buyer_id || order.supplierId !== attempt.supplier_id || mandate.buyer_id !== order.buyerId ||
      mandate.supplier_id !== order.supplierId || source.mandateId !== mandate.id || handover.quantity !== attempt.quantity ||
      source.amountCents.toString() !== attempt.amount_cents || source.amountDrops !== attempt.amount_drops ||
      mandate.recipient !== attempt.recipient || mandate.destination_tag !== attempt.destination_tag) {
    throw new MarketplaceError('The immutable handover or buyer mandate does not authorize this payment.', 409);
  }
  await requireVerifiedPair(db, order.buyerId, order.supplierId);
  return mandate;
}

export async function verifyXrplIntent(db: DbSession, attempt: AttemptRow) {
  const config = enabledXrpl();
  const mandate = await verifyXrplEvidence(db, attempt);
  assertDestination(config, attempt.supplier_id, attempt.recipient, attempt.destination_tag ?? undefined);
  const amount = BigInt(attempt.amount_drops);
  if (mandate.paused) throw new MarketplaceError('The buyer paused this XRPL Testnet mandate.', 409);
  if (amount > BigInt(mandate.max_drops) || amount > BigInt(config.maxPaymentDrops)) throw new MarketplaceError('The accepted handover exceeds the per-payment cap.', 409);
  return { config, mandate, amount };
}

export function paymentEvidence(attempt: AttemptRow): XrplEvidence {
  return { attemptId: attempt.id, orderId: attempt.order_id, sourceId: attempt.source_id, supplierId: attempt.supplier_id,
    acceptedQuantity: attempt.quantity, quoteAmountCents: Number(attempt.amount_cents), drops: attempt.amount_drops, mandateId: attempt.mandate_id };
}

export async function auditXrpl(db: DbSession, attempt: AttemptRow, action: string, reason?: string) {
  const auditId = randomUUID();
  await save(db, tables.audit, auditId, { action, recordId: attempt.id, orderId: attempt.order_id, reason, at: new Date().toISOString() }, { company_id: attempt.buyer_id });
}
