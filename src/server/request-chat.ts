import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Actor, PurchaseRequest } from '../shared/marketplace';
import { requestMessageLimit, type RequestConversation, type RequestMessage } from '../shared/request-chat';
import { actorCompany, MarketplaceError, notify, requireFound } from './access';
import type { DbSession } from './db';
import { id, parse } from './inputs';
import { dateIn } from './seed';

const pageSize = 30;
const threadFields = { requestId: id, supplierId: id };

type MessageRow = {
  id: string;
  author_company_id: string;
  author_user_id: string | null;
  author_name: string;
  body: string;
  created_at: Date | string;
};

type ThreadRow = { buyer_id: string; request: PurchaseRequest; status: string };

function publicMessage(row: MessageRow): RequestMessage {
  return { id: row.id, authorCompanyId: row.author_company_id, authorName: row.author_name,
    body: row.body, createdAt: new Date(row.created_at).toISOString(), legacy: row.author_user_id === null || undefined };
}

function buyerRole(actor: Actor, write = false) {
  return actor.role === 'owner' || actor.role === 'purchaser' || (!write && actor.role === 'approver');
}

function supplierRole(actor: Actor) { return actor.role === 'owner' || actor.role === 'sales'; }

function scope(actor: Actor, write = false) {
  return sql`r.company_id <> i.company_id and (
    (${buyerRole(actor, write)} and r.company_id = ${actor.companyId}) or
    (${supplierRole(actor)} and i.company_id = ${actor.companyId})
  )`;
}

async function authorizedThread(db: DbSession, actor: Actor, requestId: string, supplierId: string, write = false) {
  await actorCompany(actor, db);
  const result = await sql<ThreadRow>`select r.company_id as buyer_id, r.data as request, i.data->>'status' as status
    from supplier_invitations i join purchase_requests r on r.id = i.request_id
    where i.request_id = ${requestId} and i.company_id = ${supplierId} and ${scope(actor, write)}`.execute(db);
  return requireFound(result.rows[0], 'This request conversation was not found.');
}

function page(supplierId: string, rows: MessageRow[]): RequestConversation {
  return { supplierId, messages: rows.slice(0, pageSize).reverse().map(publicMessage), hasEarlier: rows.length > pageSize };
}

export async function readRequestConversations(db: DbSession, actor: Actor): Promise<Map<string, RequestConversation[]>> {
  const conversations = new Map<string, RequestConversation[]>();
  if (!buyerRole(actor) && !supplierRole(actor)) return conversations;
  const result = await sql<MessageRow & { request_id: string; supplier_id: string }>`
    select i.request_id, i.company_id as supplier_id, m.*
    from supplier_invitations i join purchase_requests r on r.id = i.request_id
    cross join lateral (
      select id, author_company_id, author_user_id, author_name, body, created_at from request_messages
      where request_id = i.request_id and supplier_id = i.company_id
      order by created_at desc, id desc limit ${pageSize + 1}
    ) m where ${scope(actor)}
    order by i.request_id, i.company_id, m.created_at desc, m.id desc`.execute(db);
  const threads = new Map<string, Map<string, MessageRow[]>>();
  for (const row of result.rows) {
    const suppliers = threads.get(row.request_id) ?? new Map<string, MessageRow[]>();
    const messages = suppliers.get(row.supplier_id) ?? [];
    messages.push(row);
    suppliers.set(row.supplier_id, messages);
    threads.set(row.request_id, suppliers);
  }
  for (const [requestId, suppliers] of threads) {
    conversations.set(requestId, Array.from(suppliers, ([supplierId, messages]) => page(supplierId, messages)));
  }
  return conversations;
}

export async function readEarlierRequestMessages(db: DbSession, actor: Actor, input: unknown) {
  const { requestId, supplierId, beforeId } = parse(z.object({ ...threadFields, beforeId: id }), input);
  await authorizedThread(db, actor, requestId, supplierId);
  const result = await sql<MessageRow>`select m.id, m.author_company_id, m.author_user_id, m.author_name, m.body, m.created_at
    from request_messages m join request_messages cursor on cursor.id = ${beforeId}
      and cursor.request_id = m.request_id and cursor.supplier_id = m.supplier_id
    where m.request_id = ${requestId} and m.supplier_id = ${supplierId}
      and (m.created_at, m.id) < (cursor.created_at, cursor.id)
    order by m.created_at desc, m.id desc limit ${pageSize + 1}`.execute(db);
  return page(supplierId, result.rows);
}

export async function postRequestMessage(db: DbSession, actor: Actor, input: unknown) {
  const { requestId, supplierId, body, messageId = randomUUID() } = parse(z.object({ ...threadFields,
    body: z.string().trim().min(1).max(requestMessageLimit), messageId: z.uuid().optional(),
  }), input);
  const thread = await authorizedThread(db, actor, requestId, supplierId, true);
  const existing = await sql<MessageRow>`select id, author_company_id, author_user_id, author_name, body, created_at
    from request_messages where id = ${messageId} and request_id = ${requestId} and supplier_id = ${supplierId}
      and author_company_id = ${actor.companyId} and author_user_id = ${actor.id}`.execute(db);
  if (existing.rows[0]) {
    if (existing.rows[0].body !== body) throw new MarketplaceError('This message ID was already used.', 409);
    return publicMessage(existing.rows[0]);
  }
  if (thread.request.status !== 'sent' || thread.status === 'declined' || thread.request.draft.requiredDate < dateIn(0)) {
    throw new MarketplaceError('This request conversation is closed.', 409);
  }
  const result = await sql<MessageRow>`insert into request_messages
    (id, request_id, supplier_id, author_company_id, author_user_id, author_name, body)
    values (${messageId}, ${requestId}, ${supplierId}, ${actor.companyId}, ${actor.id}, ${actor.name}, ${body})
    on conflict (id) do nothing returning id, author_company_id, author_user_id, author_name, body, created_at`.execute(db);
  if (!result.rows[0]) throw new MarketplaceError('This message ID was already used.', 409);
  const counterpart = actor.companyId === thread.buyer_id ? supplierId : thread.buyer_id;
  await notify(db, counterpart, 'New request message', 'Open the request to read your private conversation.',
    `#requests/${encodeURIComponent(requestId)}/chat/${encodeURIComponent(supplierId)}`);
  return publicMessage(result.rows[0]);
}
