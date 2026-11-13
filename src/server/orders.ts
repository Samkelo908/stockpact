import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  attestRelease, deliveryAmountCents, escrowStatus, EscrowVerificationError, verifyBuyerSignature,
  verifyFunding, verifyRelease, verifyRetiredRelease, type EscrowAuthorization,
} from '../integrations/escrow/server';
import type { FundingTerms } from '../integrations/escrow/shared';
import type { Actor, Company, DeliveryAuthorization, Dispute, Listing, Order, OrderTransaction, PurchaseRequest, Quote, Review } from '../shared/marketplace';
import { actorCompany, actorOrder, audit, buyerAccess, MarketplaceError, notify, requireFound, requireRole, supplierAccess } from './access';
import { record, records, save, tables, update, type DbSession } from './db';
import { id, parse, quantity, rating } from './inputs';
import { dateIn, now } from './seed';

type StoredOrder = Order & { fundingTerms?: FundingTerms };
type StoredQR = DeliveryAuthorization & { id: string; supplierId: string; nonce: `0x${string}`; previousQuantity: number;
  authorization?: EscrowAuthorization; platformSignature?: `0x${string}`; buyerSignature?: `0x${string}`; transactionHash?: `0x${string}`;
  signaturePrivate?: true; retiredAtBlock?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenField = z.string().regex(/^spqr_[a-f0-9]{64}$/i, 'Enter a valid StockPact QR code.');
const hashField = z.string().regex(/^0x[\da-f]{64}$/i, 'Enter a valid transaction hash.').transform((value) => value.toLowerCase() as `0x${string}`);
const signatureField = z.string().regex(/^0x[\da-f]{130}$/i, 'Enter a valid wallet signature.').transform((value) => value as `0x${string}`);
const transactionFields = { hash: hashField.optional(), transactionHash: hashField.optional() };
const settled = (order: Order) => order.acceptedQuantity + (order.refundedQuantity ?? 0);
const releaseAmount = (order: Order, units: number) => deliveryAmountCents(order.totalCents, order.quantity, settled(order), units);
const orderChanged = (order: Order, title: string) => order.timeline.push({ title, at: now() });

export async function approveOrder(db: DbSession, actor: Actor, orderId: string) {
  const order = await actorOrder(db, actor, orderId);
  buyerAccess(actor, order, 'owner', 'approver');
  if (order.status !== 'approval') throw new MarketplaceError('This order is not awaiting approval.', 409);
  order.status = 'awaiting_funding';
  orderChanged(order, 'Purchase approved');
  await update(db, tables.orders, order.id, order);
  await audit(db, actor, 'approve_order', order.id);
  return order;
}

export async function prepareFunding(db: DbSession, actor: Actor, orderId: string) {
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  buyerAccess(actor, order, 'owner', 'approver');
  if (escrowStatus().mode !== 'testnet') throw new MarketplaceError('A testnet escrow provider is unavailable.', 422);
  if (order.status !== 'awaiting_funding') throw new MarketplaceError('This order is not ready for funding.', 409);
  if (order.fundingTerms) return order.fundingTerms;
  const buyer = await actorCompany(actor, db);
  const supplier = requireFound(await record<Company>(db, tables.companies, order.supplierId));
  if (!buyer.wallet || !supplier.wallet) throw new MarketplaceError('The buyer and supplier must verify their testnet wallets in Company settings.', 422);
  order.fundingTerms = { orderId: order.id, buyerWallet: buyer.wallet, supplierWallet: supplier.wallet,
    amountCents: order.totalCents, quantity: order.quantity };
  await update(db, tables.orders, order.id, order);
  return order.fundingTerms;
}

async function recordTransaction(db: DbSession, order: Order, fields: Omit<OrderTransaction, 'createdAt'>) {
  const existing = await record<OrderTransaction>(db, tables.transactions, fields.id);
  if (existing && !order.transactions.some((item) => item.id === fields.id)) {
    throw new MarketplaceError('That transaction is already associated with another order.', 409);
  }
  const tx: OrderTransaction = { ...fields, createdAt: existing?.createdAt ?? now() };
  order.transactions = [...order.transactions.filter((item) => item.id !== tx.id), tx];
  await save(db, tables.transactions, tx.id, tx, { order_id: order.id });
  await update(db, tables.orders, order.id, order);
}

async function recordReceiptError(db: DbSession, order: Order, error: unknown, tx: Omit<OrderTransaction, 'createdAt' | 'status'>) {
  if (!(error instanceof EscrowVerificationError)) throw error;
  await recordTransaction(db, order, { ...tx, id: `attempt:${order.id}:${tx.id}`, status: error.status === 422 ? 'failed' : 'pending' });
  return { paymentError: error.message, paymentStatus: error.status };
}

export async function fundOrder(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, hash: suppliedHash, transactionHash = suppliedHash } = parse(z.object({ orderId: id, ...transactionFields }), input);
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  buyerAccess(actor, order, 'owner', 'approver');
  if (order.fundedCents && transactionHash && order.transactions.some((tx) => tx.hash === transactionHash && tx.status === 'confirmed')) return order;
  if (order.status !== 'awaiting_funding') throw new MarketplaceError('This order is not ready for funding.', 409);
  const mode = escrowStatus().mode;
  if (mode === 'disabled' || (mode === 'demo' && !actor.demoRole)) throw new MarketplaceError('Testnet funding is unavailable for this company.', 503);
  let txId = `demo-funding:${order.id}`;
  if (mode === 'testnet') {
    const fundingTerms = requireFound(order.fundingTerms, 'Prepare funding terms before submitting a transaction.');
    if (!transactionHash) throw new MarketplaceError('Submit the confirmed testnet funding transaction hash.', 422);
    txId = transactionHash;
    try { await verifyFunding({ ...fundingTerms, hash: transactionHash }); }
    catch (error) { return recordReceiptError(db, order, error, { id: txId, kind: 'funding', mode, amountCents: order.totalCents, hash: transactionHash }); }
  }
  order.status = 'funded';
  order.paymentMode = mode;
  order.fundedCents = order.totalCents;
  orderChanged(order, mode === 'demo' ? 'Demo escrow reserved' : 'Testnet escrow funding confirmed');
  if (transactionHash) order.transactions = order.transactions.filter((tx) => tx.id !== `attempt:${order.id}:${transactionHash}`);
  await recordTransaction(db, order, { id: txId, kind: 'funding', mode, status: 'confirmed', amountCents: order.totalCents, hash: transactionHash });
  await notify(db, order.supplierId, 'Order funded', `${order.reference} is ready to fulfil.`, '#orders');
  await audit(db, actor, 'fund_order', order.id);
  return order;
}

export async function dispatchOrder(db: DbSession, actor: Actor, orderId: string) {
  const order = await actorOrder(db, actor, orderId);
  supplierAccess(actor, order);
  if (order.status !== 'funded') throw new MarketplaceError('Fund the order before dispatching.', 409);
  order.status = 'dispatched';
  orderChanged(order, order.location === 'Supplier collection' ? 'Goods ready for collection' : 'Supplier dispatched goods');
  await update(db, tables.orders, order.id, order);
  await notify(db, order.buyerId, 'Order dispatched', `${order.reference} is ready for delivery inspection.`, '#deliveries');
  return order;
}

export async function assignDriver(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, driverId } = parse(z.object({ orderId: id, driverId: id }), input);
  const order = await actorOrder(db, actor, orderId);
  supplierAccess(actor, order);
  if (!['funded', 'dispatched', 'partial'].includes(order.status)) throw new MarketplaceError('The order is not ready for driver assignment.', 409);
  if (order.paymentMode === 'testnet') throw new MarketplaceError('Testnet releases currently require the supplier wallet.', 422);
  const company = await actorCompany(actor, db);
  if (company.verification.delivery !== 'verified') throw new MarketplaceError('The delivery company must be verified.', 403);
  const driver = await sql<{ name: string }>`select u.name from memberships m join "user" u on u.id = m.user_id
    where m.company_id = ${actor.companyId} and m.user_id = ${driverId} and m.role = 'driver'`.execute(db);
  const assigned = requireFound(driver.rows[0], 'Choose a driver from the supplier team.');
  order.driverId = driverId;
  orderChanged(order, `${assigned.name} assigned as delivery driver`);
  await update(db, tables.orders, order.id, order);
  return order;
}

async function activeQR(db: DbSession, orderId: string) {
  return (await records<StoredQR>(db, tables.qr, sql`order_id = ${orderId} and data->>'status' = 'active'`))[0];
}

function needsRetirementProof(qr: StoredQR): qr is StoredQR & { authorization: EscrowAuthorization } {
  return Boolean(qr.authorization && (qr.buyerSignature || !qr.signaturePrivate));
}

async function retireDelivery(db: DbSession, order: StoredOrder, qr: StoredQR, status: 'cancelled' | 'expired') {
  const proof = needsRetirementProof(qr)
    ? await verifyRetiredRelease(qr.authorization, requireFound(order.fundingTerms).buyerWallet)
    : undefined;
  if (qr.transactionHash) {
    const attempt = order.transactions.find((tx) => tx.kind === 'release' && tx.status === 'pending' && tx.hash === qr.transactionHash);
    if (attempt) await recordTransaction(db, order, { ...attempt, status: 'failed' });
  }
  await update(db, tables.qr, qr.id, { ...qr, status: proof?.status ?? status, retiredAtBlock: proof?.blockNumber });
}

export async function authorizeDelivery(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, quantity: units, existingOnly } = parse(z.object({ orderId: id, quantity, existingOnly: z.boolean().optional() }), input);
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  buyerAccess(actor, order, 'owner', 'approver');
  if (!['dispatched', 'partial'].includes(order.status) || units > order.quantity - settled(order)) {
    throw new MarketplaceError('Choose an outstanding quantity from a dispatched order.', 409);
  }
  const existing = await activeQR(db, order.id);
  if (existingOnly) {
    if (existing?.quantity !== units || !existing.token) throw new MarketplaceError('The active code has changed. Reopen the order and try again.', 409);
    return { ...publicQR(existing, existing.token), buyerWallet: order.fundingTerms?.buyerWallet,
      requiresOnChainProof: needsRetirementProof(existing) };
  }
  if (existing) {
    if (Date.parse(existing.expiresAt) > Date.now()) {
      if (existing.quantity === units && existing.token) return { ...publicQR(existing, existing.token), buyerWallet: order.fundingTerms?.buyerWallet };
      throw new MarketplaceError('An active code already exists. Cancel it or wait for it to expire.', 409);
    }
    await retireDelivery(db, order, existing, 'expired');
  }
  const token = `spqr_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const amountCents = releaseAmount(order, units);
  const qr: StoredQR = { id: hash(token), token, orderId: order.id, supplierId: order.supplierId, nonce: `0x${randomBytes(32).toString('hex')}`,
    previousQuantity: settled(order), quantity: units, amountCents, expiresAt, status: 'active' };
  if (order.paymentMode === 'testnet') {
    const terms = requireFound(order.fundingTerms);
    Object.assign(qr, await attestRelease({ ...terms, nonce: qr.nonce, totalCents: order.totalCents,
      totalQuantity: order.quantity, quantity: units, amountCents, previousQuantity: qr.previousQuantity, expiresAt }));
    qr.signaturePrivate = true;
  }
  await save(db, tables.qr, qr.id, qr, { order_id: order.id, supplier_id: order.supplierId });
  orderChanged(order, `Buyer prepared handover for ${units} ${order.unit}`);
  await update(db, tables.orders, order.id, order);
  await audit(db, actor, 'authorize_delivery', order.id);
  return { ...publicQR(qr, token), buyerWallet: order.fundingTerms?.buyerWallet };
}

function publicQR(qr: StoredQR, token: string, includeSettlement = false) {
  return { token, orderId: qr.orderId, quantity: qr.quantity, amountCents: qr.amountCents, expiresAt: qr.expiresAt,
    status: qr.status, authorization: qr.authorization, platformSignature: includeSettlement ? qr.platformSignature : undefined,
    buyerSignature: includeSettlement ? qr.buyerSignature : undefined, transactionHash: includeSettlement ? qr.transactionHash : undefined };
}

async function loadQR(db: DbSession, actor: Actor, token: string) {
  const qr = requireFound(await record<StoredQR>(db, tables.qr, hash(token)), 'Delivery code was not found.');
  const order = await actorOrder(db, actor, qr.orderId) as StoredOrder;
  if (qr.supplierId !== order.supplierId) throw new MarketplaceError('The code does not match the order.', 422);
  return { order, qr };
}

function ensureQR(qr: StoredQR, onChainRecovery = false) {
  if (qr.status === 'redeemed') throw new MarketplaceError('This delivery code has already been used.', 409);
  if (qr.status === 'cancelled') throw new MarketplaceError('This delivery code was cancelled.', 409);
  if (qr.retiredAtBlock || (!onChainRecovery && (qr.status === 'expired' || Date.parse(qr.expiresAt) <= Date.now()))) {
    throw new MarketplaceError('This delivery code has expired. Ask the buyer to issue a new code.', 410);
  }
}

export async function signDelivery(db: DbSession, actor: Actor, input: unknown) {
  const { token, signature } = parse(z.object({ token: tokenField, signature: signatureField }), input);
  const { qr, order } = await loadQR(db, actor, token);
  buyerAccess(actor, order, 'owner', 'approver');
  ensureQR(qr);
  if (!qr.authorization || !order.fundingTerms) throw new MarketplaceError('This delivery code has no testnet authorization.', 422);
  if (!await verifyBuyerSignature({ authorization: qr.authorization, buyerWallet: order.fundingTerms.buyerWallet, signature })) {
    throw new MarketplaceError('The signature does not match the buyer wallet or approved delivery.', 422);
  }
  qr.buyerSignature = signature;
  await update(db, tables.qr, qr.id, qr);
  return publicQR(qr, token);
}

export async function inspectDelivery(db: DbSession, actor: Actor, input: unknown) {
  const { token } = parse(z.object({ token: tokenField }), input);
  const { qr, order } = await loadQR(db, actor, token);
  supplierAccess(actor, order, true);
  ensureQR(qr, order.paymentMode === 'testnet' && Boolean(qr.buyerSignature));
  if (order.paymentMode === 'testnet' && !qr.buyerSignature) throw new MarketplaceError('The buyer still needs to sign this code with their wallet.', 409);
  return publicQR(qr, token, true);
}

export async function cancelDelivery(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, token } = parse(z.object({ orderId: id, token: tokenField.optional() }), typeof input === 'string' ? { orderId: input } : input);
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  buyerAccess(actor, order, 'owner', 'approver');
  const qr = requireFound(await activeQR(db, order.id), 'No active delivery code was found.');
  if ((token && hash(token) !== qr.id) || (!token && order.paymentMode === 'testnet')) {
    throw new MarketplaceError('The active code has changed. Reopen the order and try again.', 409);
  }
  await retireDelivery(db, order, qr, 'cancelled');
  orderChanged(order, 'Buyer cancelled the handover code');
  await update(db, tables.orders, order.id, order);
  return order;
}

export async function redeemDelivery(db: DbSession, actor: Actor, input: unknown) {
  const { token, hash: suppliedHash, transactionHash = suppliedHash, simulateInterruption } = parse(z.object({ token: tokenField,
    ...transactionFields, simulateInterruption: z.boolean().default(false) }), input);
  const { qr, order } = await loadQR(db, actor, token);
  supplierAccess(actor, order, true);
  if (order.paymentMode === 'testnet' && qr.status === 'redeemed' && transactionHash && qr.transactionHash === transactionHash &&
      order.transactions.some((tx) => tx.hash === transactionHash && tx.status === 'confirmed')) return order;
  ensureQR(qr, order.paymentMode === 'testnet' && Boolean(qr.buyerSignature && transactionHash));
  if (!order.paymentMode || !['dispatched', 'partial'].includes(order.status) || qr.previousQuantity !== settled(order) ||
      order.releasedCents + order.refundedCents + qr.amountCents > order.fundedCents) throw new MarketplaceError('The order balance or accepted quantity has changed.', 409);
  const mode = order.paymentMode;
  let txId = `demo-release:${qr.id}`;
  if (mode === 'testnet') {
    const terms = requireFound(order.fundingTerms);
    if (!qr.buyerSignature || !transactionHash) throw new MarketplaceError('A signed release and its transaction hash are required.', 422);
    txId = transactionHash;
    try {
      const receipt = await verifyRelease({ ...terms, hash: transactionHash, nonce: qr.nonce, amountCents: qr.amountCents,
        quantity: qr.quantity, previousQuantity: qr.previousQuantity });
      if (receipt.submittedBy.toLowerCase() !== terms.supplierWallet.toLowerCase()) {
        throw new EscrowVerificationError('The transaction was not sent by the pinned supplier wallet.', 422);
      }
    } catch (error) {
      if (error instanceof EscrowVerificationError) await update(db, tables.qr, qr.id, {
        ...qr, transactionHash: error.status === 422 ? undefined : transactionHash,
      });
      return recordReceiptError(db, order, error, { id: txId, kind: 'release', mode, amountCents: qr.amountCents, quantity: qr.quantity, hash: transactionHash });
    }
  }
  if (mode === 'demo' && actor.demoRole && simulateInterruption && !order.transactions.some((entry) => entry.id === txId)) {
    await recordTransaction(db, order, { id: txId, kind: 'release', mode, status: 'pending', amountCents: qr.amountCents, quantity: qr.quantity });
    return { paymentError: 'Demo payment interrupted before settlement. Retry this same code.', paymentStatus: 409 };
  }
  order.acceptedQuantity += qr.quantity;
  order.releasedCents += qr.amountCents;
  order.status = settled(order) === order.quantity ? 'completed' : 'partial';
  orderChanged(order, `${qr.quantity} ${order.unit} accepted · ${mode === 'demo' ? 'demo payment recorded' : 'testnet payment confirmed'}`);
  await update(db, tables.qr, qr.id, { ...qr, status: 'redeemed', transactionHash });
  if (transactionHash) order.transactions = order.transactions.filter((tx) => tx.id !== `attempt:${order.id}:${transactionHash}`);
  await recordTransaction(db, order, { id: txId, kind: 'release', mode, status: 'confirmed', amountCents: qr.amountCents,
    quantity: qr.quantity, hash: transactionHash });
  await notify(db, order.buyerId, 'Delivery accepted', `${order.reference} · ${qr.quantity} ${order.unit} accepted.`, '#orders');
  await notify(db, order.supplierId, mode === 'demo' ? 'Demo payment recorded' : 'Testnet payment confirmed', `${order.reference} · receipt available.`, '#funds');
  await audit(db, actor, 'redeem_delivery', order.id);
  return order;
}

export async function postMessage(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, body } = parse(z.object({ orderId: id, body: z.string().trim().min(1).max(2000) }), input);
  const order = await actorOrder(db, actor, orderId);
  if (actor.role === 'reviewer') throw new MarketplaceError('Reviewers cannot post in order conversations.', 403);
  const message = { id: randomUUID(), authorId: actor.id, author: actor.name, body, createdAt: now() };
  order.messages.push(message);
  await update(db, tables.orders, order.id, order);
  return message;
}

export async function reviewOrder(db: DbSession, actor: Actor, input: unknown) {
  const values = parse(z.object({ orderId: id, rating, quality: rating.optional(), reliability: rating.optional(), accuracy: rating.optional(),
    communication: rating.optional(), comment: z.string().trim().min(2).max(1500) }), input);
  const order = await actorOrder(db, actor, values.orderId);
  buyerAccess(actor, order, 'owner', 'purchaser');
  if (order.status !== 'completed' || order.reviewId || order.buyerId === order.supplierId || order.acceptedQuantity === 0) {
    throw new MarketplaceError('Only completed purchases can receive one buyer review.', 409);
  }
  const review: Review = { ...values, id: randomUUID(), supplierId: order.supplierId, buyerId: order.buyerId,
    quality: values.quality ?? values.rating, reliability: values.reliability ?? values.rating,
    accuracy: values.accuracy ?? values.rating, communication: values.communication ?? values.rating,
    createdAt: now(), demo: Boolean(actor.demoRole) };
  await save(db, tables.reviews, review.id, review, { order_id: order.id, company_id: order.supplierId });
  await update(db, tables.orders, order.id, { ...order, reviewId: review.id });
  await notify(db, order.supplierId, 'New supplier review', `${order.reference} received a buyer review.`, '#reviews');
  return review;
}

export async function reorder(db: DbSession, actor: Actor, orderId: string) {
  const order = await actorOrder(db, actor, orderId);
  buyerAccess(actor, order, 'owner', 'purchaser');
  const request = requireFound(await record<PurchaseRequest>(db, tables.requests, order.requestId));
  return { ...request.draft, quantity: order.quantity, requiredDate: dateIn(3), budgetCents: null, shareBudget: false, mode: 'manual' };
}

export async function cancelOrder(db: DbSession, actor: Actor, orderId: string) {
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  buyerAccess(actor, order, 'owner', 'approver');
  if (!['approval', 'awaiting_funding'].includes(order.status) || order.transactions.some((tx) => tx.status === 'pending')) {
    throw new MarketplaceError('Only an unfunded order without a pending payment can be cancelled.', 409);
  }
  if (order.fundingTerms) throw new MarketplaceError('Testnet funding terms have been issued. Reconcile any blockchain transaction before cancelling.', 409);
  const quote = requireFound(await record<Quote>(db, tables.quotes, order.quoteId));
  const listing = requireFound(await record<Listing>(db, tables.listings, quote.listingId));
  await update(db, tables.listings, listing.id, { ...listing, available: listing.available + order.quantity, updatedAt: now() });
  await save(db, tables.movements, `cancel:${order.id}`, { kind: 'release', quantity: order.quantity, createdAt: now() }, { listing_id: listing.id, order_id: order.id });
  order.status = 'cancelled';
  orderChanged(order, 'Buyer cancelled order · reserved stock returned');
  await update(db, tables.orders, order.id, order);
  return order;
}

export async function openDispute(db: DbSession, actor: Actor, input: unknown) {
  const { orderId, reason, quantity: units } = parse(z.object({ orderId: id, reason: z.string().trim().min(4).max(1800), quantity }), input);
  const order = await actorOrder(db, actor, orderId) as StoredOrder;
  requireRole(actor, 'owner', 'approver', 'purchaser', 'sales');
  if (!['dispatched', 'partial'].includes(order.status) || units > order.quantity - settled(order)) {
    throw new MarketplaceError('Only outstanding quantities on a dispatched order can be disputed.', 409);
  }
  const qr = await activeQR(db, order.id);
  if (qr) await retireDelivery(db, order, qr, 'cancelled');
  const dispute: Dispute = { id: randomUUID(), orderId, openedBy: actor.companyId, reason, quantity: units,
    amountCents: releaseAmount(order, units), status: 'open', createdAt: now() };
  await save(db, tables.disputes, dispute.id, dispute, { order_id: order.id });
  order.status = 'disputed';
  orderChanged(order, order.paymentMode === 'testnet' ? 'Delivery dispute recorded in StockPact' : 'Delivery dispute opened');
  await update(db, tables.orders, order.id, order);
  await notify(db, actor.companyId === order.buyerId ? order.supplierId : order.buyerId, 'Delivery dispute opened', `${order.reference} has a delivery dispute.`, '#orders');
  await audit(db, actor, 'open_dispute', dispute.id);
  return dispute;
}

export async function resolveDispute(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'reviewer');
  const { disputeId, resolution, refund } = parse(z.object({ disputeId: id, resolution: z.string().trim().min(4).max(1800), refund: z.boolean().default(false) }), input);
  const dispute = requireFound(await record<Dispute>(db, tables.disputes, disputeId));
  const order = await actorOrder(db, actor, dispute.orderId);
  if (dispute.status !== 'open' || order.status !== 'disputed') throw new MarketplaceError('This dispute has already been resolved.', 409);
  if (refund && order.paymentMode !== 'demo') throw new MarketplaceError('A confirmed on-chain refund is required for testnet escrow.', 422);
  if (refund) {
    order.refundedQuantity = (order.refundedQuantity ?? 0) + dispute.quantity;
    order.refundedCents += dispute.amountCents;
    await recordTransaction(db, order, { id: `demo-refund:${dispute.id}`, kind: 'refund', mode: 'demo', status: 'confirmed',
      amountCents: dispute.amountCents, quantity: dispute.quantity });
  }
  order.status = settled(order) === order.quantity ? (order.acceptedQuantity === 0 ? 'cancelled' : 'completed') : settled(order) > 0 ? 'partial' : 'dispatched';
  orderChanged(order, refund ? 'Reviewer resolved dispute · demo refund recorded' : 'Reviewer resolved dispute · delivery may continue');
  await update(db, tables.orders, order.id, order);
  await update(db, tables.disputes, dispute.id, { ...dispute, status: 'resolved', resolution });
  await notify(db, order.buyerId, 'Delivery dispute resolved', `${order.reference} was reviewed.`, '#orders');
  await notify(db, order.supplierId, 'Delivery dispute resolved', `${order.reference} was reviewed.`, '#orders');
  await audit(db, actor, 'resolve_dispute', dispute.id);
  return order;
}
