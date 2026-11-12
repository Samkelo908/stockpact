import { sql } from 'kysely';
import { escrowStatus } from '../integrations/escrow/server';
import { purchasingMode } from '../integrations/purchasing';
import { verificationProvider } from '../integrations/verification';
import type { Actor, Company, DeliveryAuthorization, Dispute, Listing, MarketplaceState, Notice, Order, PurchaseRequest, Quote, Review, ShoppingList, SupplierResponse, VerificationCheck } from '../shared/marketplace';
import { orderScope } from './access';
import { demoEnabled, getDb, record, records, tables } from './db';
import { demoRoleOptions } from './seed';

export type Preferences = { favorites: string[]; preferredSuppliers: string[] };
export const defaultPreferences = (): Preferences => ({ favorites: [], preferredSuppliers: [] });

function recent<T extends { createdAt: string }>(items: T[]) {
  return items.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export async function marketplaceState(actor: Actor | null): Promise<MarketplaceState> {
  const demo = demoEnabled();
  const base: MarketplaceState = { actor, demo, aiMode: purchasingMode(), escrow: escrowStatus(), roles: demo ? demoRoleOptions : [],
    companies: [], listings: [], requests: [], quotes: [], orders: [], notifications: [], favorites: [], preferredSuppliers: [],
    reviews: [], disputes: [], shoppingLists: [], team: [] };
  if (!actor) return base;
  const provider = verificationProvider();
  if (actor.role === 'owner' && provider && (!actor.demoRole || provider.sandbox)) {
    base.verificationProvider = { sandbox: provider.sandbox, scopes: provider.scopes };
  }
  const db = await getDb();
  const own = actor.companyId;
  const realm = Boolean(actor.demoRole);
  const orderWhere = orderScope(actor);
  const canBuy = ['owner', 'purchaser', 'approver'].includes(actor.role);
  const canSell = ['owner', 'sales'].includes(actor.role);
  const requestWhere = sql`(${canBuy} and company_id = ${own}) or (${canSell} and exists (
    select 1 from supplier_invitations s where s.request_id = purchase_requests.id and s.company_id = ${own}))`;
  const companyWhere = sql`demo = ${realm} and (id = ${own} or data->'verification'->>'business' = 'verified' or ${actor.role === 'reviewer'})`;
  const [companies, listings, requests, quotes, orders, notices, prefs, reviews, disputes, shopping, team, authorizations, responses, verification] = await Promise.all([
    records<Company>(db, tables.companies, companyWhere),
    records<Listing>(db, tables.listings, sql`company_id in (select id from companies where ${companyWhere})
      and (company_id = ${own} or data->>'archived' = 'false')`),
    records<PurchaseRequest>(db, tables.requests, requestWhere),
    records<Quote>(db, tables.quotes, sql`(${canSell} and company_id = ${own}) or (${canBuy} and request_id in (select id from purchase_requests where company_id = ${own}))`),
    records<Order>(db, tables.orders, orderWhere),
    records<Notice>(db, tables.notifications, sql`company_id = ${own} and ${actor.role !== 'driver'}`),
    record<Preferences>(db, tables.preferences, `${own}:${actor.id}`),
    records<Review>(db, tables.reviews, sql`company_id in (select id from companies where ${companyWhere})`),
    records<Dispute>(db, tables.disputes, sql`order_id in (select id from orders where ${orderWhere})`),
    records<ShoppingList>(db, tables.shopping, sql`company_id = ${own} and ${canBuy}`),
    sql<MarketplaceState['team'][number]>`select u.id, u.name, u.email, m.role from memberships m join "user" u on u.id = m.user_id
      where m.company_id = ${own} and ${actor.role === 'owner'} order by u.name`.execute(db),
    records<DeliveryAuthorization>(db, tables.qr, sql`order_id in (select id from orders where ${orderWhere})
      and data->>'status' = 'active' and (data->>'expiresAt')::timestamptz > now()`),
    sql<{ requestId: string; supplierId: string; data: Omit<SupplierResponse, 'supplierId'> }>`select request_id as "requestId", company_id as "supplierId", data
      from supplier_invitations where (${canSell} and company_id = ${own}) or
      (${canBuy} and request_id in (select id from purchase_requests where company_id = ${own}))`.execute(db),
    sql<VerificationCheck>`select id, company_id as "companyId", scope, status, provider, note, created_at as "createdAt",
      case when ${actor.role === 'reviewer'} then provider_reference else null end as "providerReference"
      from verification_checks where (${actor.role === 'owner'} and company_id = ${own}) or
      (${actor.role === 'reviewer'} and company_id in (select id from companies where demo = ${realm}))
      order by created_at desc limit 150`.execute(db),
  ]);
  const protectedCompanies = companies.map((company) => company.id === own || actor.role === 'reviewer' ? company : {
    ...company, registrationNumber: undefined, contact: undefined, representative: undefined,
    verificationNote: undefined, approvalThresholdCents: undefined, wallet: undefined,
  });
  const authorizedRequests = requests.map((request) => {
    const supplierResponses = responses.rows.filter((entry) => entry.requestId === request.id).map(({ supplierId, data }) => ({ supplierId, ...data }));
    if (request.buyerId === own) return { ...request, supplierResponses };
    return { ...request, draft: { ...request.draft, budgetCents: request.draft.shareBudget ? request.draft.budgetCents : null },
      matches: request.matches.filter(({ supplierId }) => supplierId === own), supplierIds: [own],
      supplierResponses, activity: supplierResponses.flatMap(({ activity }) => activity ?? []) };
  });
  return { ...base, ...prefs, companies: protectedCompanies, listings, requests: recent(authorizedRequests), quotes: recent(quotes),
    orders: recent(orders.map((order) => {
      const qr = authorizations.find((entry) => entry.orderId === order.id);
      return { ...order, activeAuthorization: qr ? { quantity: qr.quantity, amountCents: qr.amountCents, expiresAt: qr.expiresAt } : undefined };
    })), notifications: recent(notices), reviews: recent(reviews), disputes: recent(disputes), shoppingLists: shopping, team: team.rows,
    verificationHistory: verification.rows };
}
