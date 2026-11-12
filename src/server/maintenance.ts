import { sql } from 'kysely';
import type { PurchaseRequest, ShoppingList } from '../shared/marketplace';
import { notify } from './access';
import { mutate, records, tables, update } from './db';
import { dateIn, now } from './seed';

export async function runMarketplaceMaintenance() {
  const today = dateIn(0);
  return mutate(async (db) => {
    const stale = await records<PurchaseRequest>(db, tables.requests, sql`data->>'status' in ('draft','matched','sent')
      and data->'draft'->>'requiredDate' < ${today} order by data->'draft'->>'requiredDate' limit 40`);
    for (const request of stale) {
      await update(db, tables.requests, request.id, { ...request, status: 'expired', activity: [...request.activity, { title: 'Request expired', at: now() }] });
      if (request.status === 'sent') await notify(db, request.buyerId, 'Quote request expired', `The requested delivery date for ${request.draft.product} has passed.`, '#requests');
    }
    const due = await sql<{ companyId: string; data: ShoppingList }>`select company_id as "companyId", data from shopping_lists
      where data->>'remindAt' <= ${today} and data->>'remindedAt' is null order by data->>'remindAt' limit 40`.execute(db);
    for (const { companyId, data } of due.rows) {
      await notify(db, companyId, 'Shopping list reminder', `${data.name} is ready to reorder at current prices.`, '#requests');
      await update(db, tables.shopping, data.id, { ...data, remindedAt: now() });
    }
    return { expiredRequests: stale.length, reminders: due.rows.length };
  });
}
