import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { getDb, record, records, save, tables, type DbSession } from './db';
import { now } from './seed';
import type { Actor, Company, CompanyRole, Notice, Order, PurchaseRequest } from '../shared/marketplace';

export class MarketplaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function requireRole(actor: Actor, ...roles: CompanyRole[]) {
  if (!roles.includes(actor.role)) throw new MarketplaceError('Your role cannot perform this action.', 403);
}

export function requireFound<T>(item: T | null | undefined, message = 'The record could not be found.'): T {
  if (item == null) throw new MarketplaceError(message, 404);
  return item;
}

export async function actorCompany(actor: Actor, db: DbSession) {
  const company = requireFound(await record<Company>(db, tables.companies, actor.companyId));
  if (company.demo !== Boolean(actor.demoRole)) throw new MarketplaceError('Company access is unavailable.', 403);
  return company;
}

export function requireCapability(company: Company, capability: Company['capabilities'][number]) {
  if (!company.capabilities.includes(capability)) throw new MarketplaceError(`Enable the ${capability} capability in Company settings.`, 403);
}

export async function buyerRequest(db: DbSession, actor: Actor, requestId: string) {
  return requireFound((await records<PurchaseRequest>(db, tables.requests, sql`id = ${requestId} and company_id = ${actor.companyId}`))[0], 'Request was not found.');
}

export async function supplierRequest(db: DbSession, actor: Actor, requestId: string) {
  return requireFound((await records<PurchaseRequest>(db, tables.requests, sql`id = ${requestId} and exists (
    select 1 from supplier_invitations s where s.request_id = purchase_requests.id and s.company_id = ${actor.companyId}
  )`))[0], 'Request was not found.');
}

export function orderScope(actor: Actor) {
  if (actor.role === 'reviewer') return sql`company_id in (select id from companies where demo = ${Boolean(actor.demoRole)})`;
  if (actor.role === 'driver') return sql`(supplier_id = ${actor.companyId} and data->>'driverId' = ${actor.id})`;
  if (actor.role === 'sales') return sql`supplier_id = ${actor.companyId}`;
  if (actor.role === 'purchaser' || actor.role === 'approver') return sql`company_id = ${actor.companyId}`;
  return sql`(company_id = ${actor.companyId} or supplier_id = ${actor.companyId})`;
}

export async function actorOrder(db: DbSession, actor: Actor, orderId: string) {
  return requireFound((await records<Order>(db, tables.orders, sql`id = ${orderId} and ${orderScope(actor)}`))[0], 'Order was not found.');
}

export function buyerAccess(actor: Actor, order: Order, ...roles: CompanyRole[]) {
  requireRole(actor, ...roles);
  if (order.buyerId !== actor.companyId) throw new MarketplaceError('This action requires the buyer company.', 403);
}

export function supplierAccess(actor: Actor, order: Order, allowDriver = false) {
  if (allowDriver && actor.role === 'driver' && order.supplierId === actor.companyId && order.driverId === actor.id) return;
  requireRole(actor, 'owner', 'sales');
  if (order.supplierId !== actor.companyId) throw new MarketplaceError('This action requires the supplier company or its assigned driver.', 403);
}

export async function notify(db: DbSession, companyId: string, title: string, body: string, href: string) {
  const notice: Notice = { id: randomUUID(), title, body, href, read: false, createdAt: now() };
  await save(db, tables.notifications, notice.id, notice, { company_id: companyId });
}

export async function audit(db: DbSession, actor: Actor, action: string, recordId: string, details?: Record<string, unknown>) {
  const id = randomUUID();
  await save(db, tables.audit, id, { actorId: actor.id, action, recordId, details, at: now() }, { company_id: actor.companyId });
}

export async function getActorCompany(actor: Actor) { return actorCompany(actor, await getDb()); }
