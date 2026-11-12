import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Actor, Company, Listing, Match, Order, PurchaseRequest, Quote, RequestDraft, SupplierResponse } from '../shared/marketplace';
import { actorCompany, audit, buyerRequest, MarketplaceError, notify, requireCapability, requireFound, requireRole, supplierRequest } from './access';
import { mutate, record, records, save, tables, update, type DbSession } from './db';
import { cents, date, draft, id, listingFields, parse, quantity } from './inputs';
import { dateIn, now } from './seed';
import type { Preferences } from './state';

export type MatchingJob = { id: string; requestId: string; status: 'queued' | 'complete'; createdAt: string; completedAt?: string };
export type SupplierInvitation = Omit<SupplierResponse, 'supplierId'> & { createdAt: string };

export async function createRequest(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'purchaser');
  requireCapability(await actorCompany(actor, db), 'buyer');
  const details = parse(z.object({ draft }), input).draft;
  if (details.requiredDate < dateIn(0)) throw new MarketplaceError('The required date must be today or later.', 422);
  const request: PurchaseRequest = { id: randomUUID(), buyerId: actor.companyId, draft: details, status: 'draft',
    createdAt: now(), matches: [], supplierIds: [], activity: [{ title: 'Purchase request saved', at: now() }] };
  await save(db, tables.requests, request.id, request, { company_id: actor.companyId });
  return request;
}

export async function enqueueMatch(db: DbSession, actor: Actor, requestId: string) {
  requireRole(actor, 'owner', 'purchaser');
  const request = await buyerRequest(db, actor, requestId);
  if (request.status === 'matching') return request;
  if (!['draft', 'matched'].includes(request.status)) throw new MarketplaceError('This request has already been sent.', 409);
  request.status = 'matching';
  request.activity.push({ title: 'Supplier matching queued', at: now() });
  const job: MatchingJob = { id: randomUUID(), requestId, status: 'queued', createdAt: now() };
  await save(db, tables.jobs, job.id, job, { request_id: requestId });
  await update(db, tables.requests, requestId, request);
  return request;
}

const productTokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const quantityUnit = (value: string) => value.trim().toLowerCase()
  .replace(/ies$/u, 'y').replace(/(x|ch|sh)es$/u, '$1').replace(/s$/u, '');

function matchListing(item: Listing, request: RequestDraft, preferred: boolean): Match | null {
  const terms = productTokens(request.product);
  const searchable = productTokens(`${item.name} ${item.description} ${item.brand ?? ''}`);
  const hits = terms.filter((term) => searchable.some((word) => quantityUnit(word) === quantityUnit(term))).length;
  const eligibleArea = request.collection ? item.collection : item.deliveryAreas.some((area) => request.location.toLowerCase().includes(area.toLowerCase()));
  if (hits === 0 || hits < terms.length * 0.5 || !eligibleArea || item.available < request.quantity || item.minimum > request.quantity ||
      quantityUnit(item.unit) !== quantityUnit(request.unit) || dateIn(item.leadDays) > request.requiredDate ||
      (request.packSize && request.packSize !== item.packSize)) return null;
  return { supplierId: item.supplierId, listingId: item.id,
    score: Math.min(100, Math.round(65 + 30 * hits / terms.length + (preferred ? 5 : 0))),
    reasons: [item.name, `Listed stock covers ${request.quantity} ${request.unit}`, request.collection ? 'Collection offered' : 'Serves delivery area',
      ...(preferred ? ['Preferred supplier'] : [])] };
}

export async function runMatchingJobs(companyId?: string) {
  return mutate(async (db) => {
    const jobs = await records<MatchingJob>(db, tables.jobs, sql`data->>'status' = 'queued'
      ${companyId ? sql`and request_id in (select id from purchase_requests where company_id = ${companyId})` : sql``}
      order by data->>'createdAt' limit 12`);
    for (const job of jobs) {
      const request = await record<PurchaseRequest>(db, tables.requests, job.requestId);
      if (request?.status === 'matching') {
        const buyer = requireFound(await record<Company>(db, tables.companies, request.buyerId));
        const suppliers = await records<Listing>(db, tables.listings, sql`company_id <> ${request.buyerId} and data->>'archived' = 'false'
          and company_id in (select id from companies where demo = ${buyer.demo} and data->'verification'->>'business' = 'verified'
            and (data->'capabilities') ? 'supplier')`);
        const preferred = new Set((await records<Preferences>(db, tables.preferences, sql`company_id = ${request.buyerId}`)).flatMap((entry) => entry.preferredSuppliers));
        const matches = suppliers.flatMap((item) => {
          const result = matchListing(item, request.draft, preferred.has(item.supplierId));
          return result ? [result] : [];
        }).sort((a, b) => b.score - a.score || a.listingId.localeCompare(b.listingId));
        request.matches = [...new Map(matches.reverse().map((match) => [match.supplierId, match])).values()]
          .sort((a, b) => b.score - a.score);
        request.status = 'matched';
        request.matchedAt = now();
        request.activity.push({ title: request.matches.length ? `${request.matches.length} eligible ${request.matches.length === 1 ? 'supplier' : 'suppliers'} found` : 'No eligible supplier found', at: now() });
        await update(db, tables.requests, request.id, request);
      }
      await update(db, tables.jobs, job.id, { ...job, status: 'complete', completedAt: now() });
    }
    return jobs.length;
  });
}

export async function sendRequest(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'purchaser');
  const { requestId, supplierIds } = parse(z.object({ requestId: id, supplierIds: z.array(id).min(1).max(30) }), input);
  const company = await actorCompany(actor, db);
  if (company.verification.business !== 'verified' || company.verification.representative !== 'verified') {
    throw new MarketplaceError('Verify the buyer company and representative before sending a request.', 403);
  }
  const request = await buyerRequest(db, actor, requestId);
  const unique = [...new Set(supplierIds)];
  if (request.status === 'sent' && unique.length === request.supplierIds.length && unique.every((supplierId) => request.supplierIds.includes(supplierId))) return request;
  if (request.status !== 'matched') throw new MarketplaceError('Match suppliers before sending this request.', 409);
  if (request.draft.requiredDate < dateIn(0)) throw new MarketplaceError('The requested delivery date has passed.', 409);
  if (unique.some((supplierId) => !request.matches.some((item) => item.supplierId === supplierId))) {
    throw new MarketplaceError('Only matched suppliers may be invited.', 422);
  }
  const eligible = await records<Company>(db, tables.companies, sql`id in (${sql.join(unique)}) and demo = ${company.demo}
    and data->'verification'->>'business' = 'verified' and (data->'capabilities') ? 'supplier'`);
  if (eligible.length !== unique.length) throw new MarketplaceError('A selected supplier is no longer eligible. Match suppliers again.', 409);
  request.status = 'sent';
  request.supplierIds = unique;
  request.activity.push({ title: `Request sent to ${unique.length} ${unique.length === 1 ? 'supplier' : 'suppliers'}`, at: now() });
  for (const supplierId of unique) {
    await save(db, tables.invitations, `${request.id}:${supplierId}`, { status: 'sent', createdAt: now() }, { company_id: supplierId, request_id: request.id });
    await notify(db, supplierId, 'New request for quote', `${company.name} needs ${request.draft.quantity} ${request.draft.unit} of ${request.draft.product}.`, '#requests');
  }
  await update(db, tables.requests, request.id, request);
  await audit(db, actor, 'send_request', request.id);
  return request;
}

export async function submitQuote(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'sales');
  const { requestId, listingId, unitPriceCents, quantity: units, deliveryFeeCents, deliveryDate, notes, taxCents, expiresAt } = parse(z.object({
    requestId: id, unitPriceCents: cents.min(1), quantity, deliveryFeeCents: cents, taxCents: cents.default(0),
    listingId: id.optional(), deliveryDate: date, notes: z.string().trim().max(1500).default(''),
    expiresAt: z.union([date, z.literal(''), z.null()]).optional(),
  }), input);
  const company = await actorCompany(actor, db);
  requireCapability(company, 'supplier');
  if (company.verification.business !== 'verified') throw new MarketplaceError('Verify the supplier company before submitting a quote.', 403);
  const request = await supplierRequest(db, actor, requestId);
  if (request.status !== 'sent' || request.draft.requiredDate < dateIn(0)) throw new MarketplaceError('This request is no longer open.', 409);
  const invitationId = `${request.id}:${actor.companyId}`;
  const invitation = requireFound(await record<SupplierInvitation>(db, tables.invitations, invitationId));
  if (invitation.status === 'declined') throw new MarketplaceError('This supplier already declined the request.', 409);
  if (deliveryDate < dateIn(0) || deliveryDate > request.draft.requiredDate) throw new MarketplaceError('Choose a delivery date between today and the requested deadline.', 422);
  const match = requireFound(request.matches.find((item) => item.supplierId === actor.companyId));
  const listing = requireFound((await records<Listing>(db, tables.listings, sql`id = ${listingId ?? match.listingId} and company_id = ${actor.companyId}`))[0], 'Listing was not found.');
  if (listing.archived || listing.available < units || listing.minimum > units) throw new MarketplaceError('The quote exceeds the current available stock or its minimum.', 409);
  const eligible = request.draft.collection ? listing.collection : listing.deliveryAreas.some((area) => request.draft.location.toLowerCase().includes(area.toLowerCase()));
  if (!eligible || dateIn(listing.leadDays) > deliveryDate || quantityUnit(listing.unit) !== quantityUnit(request.draft.unit)) {
    throw new MarketplaceError('The listing cannot meet the requested unit, delivery area, or quoted lead time.', 422);
  }
  const substitution = !matchListing(listing, { ...request.draft, quantity: units }, false);
  if (substitution && (!request.draft.substitutions || !notes)) throw new MarketplaceError('The buyer must allow substitutions and your quote must explain the alternative.', 422);
  const deadline = Date.parse(`${request.draft.requiredDate}T23:59:59+02:00`);
  const expiry = expiresAt ? Date.parse(`${expiresAt}T23:59:59+02:00`) : Math.min(Date.now() + 7 * 86_400_000, deadline);
  if (expiry <= Date.now() || expiry > deadline) throw new MarketplaceError('The quote expiry must be before the request closes.', 422);
  const versions = await records<Quote>(db, tables.quotes, sql`request_id = ${requestId} and company_id = ${actor.companyId}`);
  for (const prior of versions.filter((quote) => quote.status === 'submitted')) {
    await update(db, tables.quotes, prior.id, { ...prior, status: 'superseded' });
  }
  const quote: Quote = { id: randomUUID(), requestId, supplierId: actor.companyId, listingId: listing.id,
    product: listing.name, unit: listing.unit, packSize: listing.packSize, specification: listing.description, substitution,
    version: Math.max(0, ...versions.map((entry) => entry.version)) + 1, quantity: units, unitPriceCents, taxCents, deliveryFeeCents,
    totalCents: units * unitPriceCents + taxCents + deliveryFeeCents, currency: company.currency, deliveryDate,
    expiresAt: new Date(expiry).toISOString(),
    notes, status: 'submitted', createdAt: now() };
  await save(db, tables.quotes, quote.id, quote, { company_id: actor.companyId, request_id: requestId, listing_id: listing.id, version: quote.version });
  await update(db, tables.invitations, invitationId, { ...invitation, status: 'quoted', activity: [...(invitation.activity ?? []), { title: `Quote version ${quote.version} submitted`, at: now() }] });
  request.activity.push({ title: `${company.name} submitted quote version ${quote.version}`, at: now() });
  await update(db, tables.requests, request.id, request);
  await notify(db, request.buyerId, 'Quote received', `${company.name} quoted on ${request.draft.product}.`, '#requests');
  await audit(db, actor, 'submit_quote', quote.id);
  return quote;
}

export async function acceptQuote(db: DbSession, actor: Actor, quoteId: string) {
  requireRole(actor, 'owner', 'purchaser');
  const quote = requireFound((await records<Quote>(db, tables.quotes, sql`id = ${quoteId} and request_id in (
    select id from purchase_requests where company_id = ${actor.companyId})`))[0], 'Quote was not found.');
  const existing = (await records<Order>(db, tables.orders, sql`quote_id = ${quote.id} and company_id = ${actor.companyId}`))[0];
  if (existing) return existing;
  const request = await buyerRequest(db, actor, quote.requestId);
  if (quote.status !== 'submitted' || request.status !== 'sent' || Date.parse(quote.expiresAt) <= Date.now()) {
    throw new MarketplaceError('This quote is no longer available to accept.', 409);
  }
  const listing = requireFound(await record<Listing>(db, tables.listings, quote.listingId));
  if (listing.archived || listing.available < quote.quantity) throw new MarketplaceError('The supplier no longer has enough stock. Request an updated quote.', 409);
  if (quote.product && (quote.product !== listing.name || quote.unit !== listing.unit || quote.packSize !== listing.packSize || quote.specification !== listing.description)) {
    throw new MarketplaceError('The listing changed after this quote was submitted. Ask the supplier to confirm the current offer.', 409);
  }
  const buyer = await actorCompany(actor, db);
  const orderId = randomUUID();
  const approval = buyer.approvalThresholdCents != null && quote.totalCents >= buyer.approvalThresholdCents;
  const order: Order = { id: orderId, reference: `SP-${orderId.slice(0, 6).toUpperCase()}`, requestId: request.id, quoteId: quote.id,
    buyerId: actor.companyId, supplierId: quote.supplierId, product: quote.product ?? request.draft.product, unit: quote.unit ?? request.draft.unit,
    packSize: quote.packSize, specification: quote.specification, currency: quote.currency, quantity: quote.quantity,
    unitPriceCents: quote.unitPriceCents, totalCents: quote.totalCents, taxCents: quote.taxCents, deliveryFeeCents: quote.deliveryFeeCents,
    deliveryDate: quote.deliveryDate, location: request.draft.collection ? 'Supplier collection' : request.draft.location,
    status: approval ? 'approval' : 'awaiting_funding', fundedCents: 0, releasedCents: 0, refundedCents: 0, acceptedQuantity: 0,
    transactions: [], messages: [], timeline: [{ title: approval ? 'Quote accepted · approval required' : 'Quote accepted · stock reserved', at: now() }], createdAt: now() };
  await save(db, tables.orders, order.id, order, { company_id: order.buyerId, supplier_id: order.supplierId, request_id: request.id, quote_id: quote.id });
  await update(db, tables.listings, listing.id, { ...listing, available: listing.available - quote.quantity, updatedAt: now() });
  await save(db, tables.movements, `reserve:${order.id}`, { kind: 'reservation', quantity: -quote.quantity, createdAt: now() }, { listing_id: listing.id, order_id: order.id });
  await update(db, tables.requests, request.id, { ...request, status: 'accepted' });
  await update(db, tables.quotes, quote.id, { ...quote, status: 'accepted' });
  await notify(db, quote.supplierId, 'Quote accepted', `${buyer.name} accepted quote version ${quote.version}.`, '#orders');
  if (approval) await notify(db, order.buyerId, 'Purchase approval needed', `${order.reference} is above the approval threshold.`, '#orders');
  await audit(db, actor, 'accept_quote', quote.id);
  return order;
}

export async function saveListing(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'sales');
  const { listing: fields } = parse(z.object({ listing: listingFields }), input);
  const company = await actorCompany(actor, db);
  requireCapability(company, 'supplier');
  const existing = fields.id ? requireFound((await records<Listing>(db, tables.listings, sql`id = ${fields.id} and company_id = ${actor.companyId}`))[0]) : undefined;
  const listing: Listing = { ...fields, id: existing?.id ?? randomUUID(), supplierId: company.id, demo: company.demo, updatedAt: now() };
  await save(db, tables.listings, listing.id, listing, { company_id: company.id });
  const adjustment = listing.available - (existing?.available ?? 0);
  if (adjustment) await save(db, tables.movements, randomUUID(), { kind: 'adjustment', quantity: adjustment, createdAt: now() }, { listing_id: listing.id });
  return listing;
}
