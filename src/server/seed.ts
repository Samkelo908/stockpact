import { sql } from 'kysely';
import { demoEnabled, mutate, save, tables, type DbSession } from './db';
import type { Actor, Company, DemoRole, Listing, Order, PurchaseRequest, Quote } from '../shared/marketplace';

const southAfricaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dateIn = (days: number) => southAfricaDate.format(new Date(Date.now() + days * 86_400_000));
export const now = () => new Date().toISOString();
const cape = 'Cape Town';
const verified = { business: 'verified', representative: 'verified', delivery: 'verified' } as const;

export const demoAccounts: Record<DemoRole, Omit<Actor, 'memberships'>> = {
  buyer: { id: 'demo-buyer', demoRole: 'buyer', name: 'Maya Daniels', email: 'maya@example.test', companyId: 'demo-buyer-company', role: 'owner' },
  supplier: { id: 'demo-supplier', demoRole: 'supplier', name: 'Liam Adams', email: 'liam@example.test', companyId: 'demo-supplier-company', role: 'owner' },
  supplier2: { id: 'demo-supplier2', demoRole: 'supplier2', name: 'Amira Jacobs', email: 'amira@example.test', companyId: 'demo-supplier2-company', role: 'owner' },
  driver: { id: 'demo-driver', demoRole: 'driver', name: 'Aviwe Mbeki', email: 'aviwe@example.test', companyId: 'demo-supplier-company', role: 'driver' },
  admin: { id: 'demo-admin', demoRole: 'admin', name: 'Jordan Abrahams', email: 'jordan@example.test', companyId: 'demo-admin-company', role: 'reviewer' },
};

export const demoRoleOptions = [
  { role: 'buyer', label: 'Buyer · Harbour Table', name: 'Maya Daniels' },
  { role: 'supplier', label: 'Supplier · Cape Supply Co.', name: 'Liam Adams' },
  { role: 'supplier2', label: 'Supplier · Peninsula Wholesale', name: 'Amira Jacobs' },
  { role: 'driver', label: 'Driver · Cape Supply Co.', name: 'Aviwe Mbeki' },
  { role: 'admin', label: 'Platform reviewer', name: 'Jordan Abrahams' },
] satisfies { role: DemoRole; label: string; name: string }[];

function fictionalCompany(id: string, name: string, location: string, capabilities: Company['capabilities']): Company {
  return { id, name, legalName: `${name} (Pty) Ltd`, country: 'ZA', currency: 'ZAR', location,
    registrationNumber: 'Fictional demo record', capabilities, verification: verified, demo: true };
}

const companies: Company[] = [
  fictionalCompany('demo-buyer-company', 'Harbour Table', 'Woodstock, Cape Town', ['buyer']),
  fictionalCompany('demo-supplier-company', 'Cape Supply Co.', 'Epping, Cape Town', ['buyer', 'supplier', 'delivery']),
  fictionalCompany('demo-supplier2-company', 'Peninsula Wholesale', 'Paarden Eiland, Cape Town', ['buyer', 'supplier']),
  fictionalCompany('demo-admin-company', 'StockPact Review', cape, []),
];

function listing(id: string, supplierId: string, name: string, category: string, priceCents: number, available: number, description: string, unit = 'cases', packSize = 1): Listing {
  return { id, supplierId, name, category, description, unit, priceCents, available, minimum: 1, packSize,
    deliveryAreas: [cape, 'Woodstock', 'Epping', 'Bellville', 'Paarden Eiland', 'Milnerton'],
    leadDays: 1, deliveryFeeCents: 15_000, collection: true, archived: false, updatedAt: now(), demo: true };
}

function seedListings() {
  const supplier = companies[1].id;
  const alternate = companies[2].id;
  return [
    listing('demo-tomatoes-a', supplier, 'Chopped tomatoes', 'Food & produce', 21_500, 120, 'Italian chopped tomatoes, 12 × 400 g tins per case.', 'cases', 12),
    listing('demo-tomatoes-b', alternate, 'Chopped tomatoes', 'Food & produce', 20_500, 90, 'Caterer pack of chopped tomatoes, 12 × 400 g tins.', 'cases', 12),
    listing('demo-water-a', supplier, '500 ml still water', 'Beverages', 9_500, 110, 'Still spring water. Each case contains 24 × 500 ml bottles.', 'cases', 24),
    listing('demo-water-b', alternate, '500 ml still water', 'Beverages', 8_950, 86, 'Bottled still water, 24 × 500 ml per case.', 'cases', 24),
    listing('demo-oil', supplier, 'Sunflower oil', 'Food & produce', 18_950, 84, 'Refined sunflower cooking oil in 5 L food-service containers.', 'bottles'),
    listing('demo-coffee', alternate, 'Arabica coffee beans', 'Food & produce', 24_900, 48, 'Freshly roasted single-origin coffee beans in 1 kg bags.', 'bags'),
    listing('demo-boxes', supplier, 'Kraft takeaway boxes', 'Packaging', 30_500, 145, 'Compostable 750 ml containers, packed in cases of 100.', 'cases', 100),
    listing('demo-gloves', alternate, 'Nitrile gloves', 'Cleaning & safety', 12_750, 190, 'Powder-free blue nitrile gloves, medium. 100 per box.', 'boxes', 100),
    listing('demo-paper', supplier, 'A4 copy paper', 'Office supplies', 32_000, 37, 'Five reams of 80 gsm white A4 paper.', 'cases', 5),
    listing('demo-sanitiser', alternate, 'Surface sanitiser', 'Cleaning & safety', 16_200, 8, 'Food-safe surface sanitiser in 5 L refill bottles.', 'bottles'),
  ];
}

async function seedExamples(db: DbSession) {
  const buyer = companies[0].id;
  const supplier = companies[1].id;
  const alternate = companies[2].id;
  const at = now();
  const request: PurchaseRequest = { id: 'demo-request-sent', buyerId: buyer,
    draft: { product: 'Chopped tomatoes', quantity: 20, unit: 'cases', location: 'Woodstock, Cape Town', requiredDate: dateIn(8),
      budgetCents: 500_000, notes: '12 × 400 g tins per case', category: 'Food & produce', substitutions: false, mode: 'demo' },
    status: 'sent', createdAt: at, matchedAt: at, supplierIds: [supplier, alternate],
    matches: [ { supplierId: supplier, listingId: 'demo-tomatoes-a', score: 100, reasons: ['Chopped tomatoes', 'Listed stock covers 20 cases', 'Serves Cape Town'] },
      { supplierId: alternate, listingId: 'demo-tomatoes-b', score: 100, reasons: ['Chopped tomatoes', 'Listed stock covers 20 cases', 'Serves Cape Town'] } ],
    activity: [{ title: 'Quote request sent to 2 demo suppliers', at }] };
  await save(db, tables.requests, request.id, request, { company_id: buyer });
  for (const [index, companyId] of request.supplierIds.entries()) {
    await save(db, tables.invitations, `${request.id}:${companyId}`, { status: 'sent', createdAt: at }, { company_id: companyId, request_id: request.id });
    const unitPriceCents = index ? 20_500 : 21_500;
    const deliveryFeeCents = index ? 29_000 : 15_000;
    const quote: Quote = { id: `demo-quote-${index + 1}`, requestId: request.id, supplierId: companyId,
      listingId: request.matches[index].listingId, version: 1, quantity: 20, unitPriceCents, taxCents: 0,
      deliveryFeeCents, totalCents: 20 * unitPriceCents + deliveryFeeCents, currency: 'ZAR', deliveryDate: dateIn(index + 2),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), notes: 'Tax included. 12 × 400 g tins per case.', status: 'submitted', createdAt: at };
    await save(db, tables.quotes, quote.id, quote, { request_id: request.id, company_id: companyId, listing_id: quote.listingId, version: 1 });
  }

  for (const example of [
    { slug: 'complete', product: 'Kraft takeaway boxes', listingId: 'demo-boxes', price: 30_500, quantity: 10, status: 'completed' },
    { slug: 'dispute', product: 'A4 copy paper', listingId: 'demo-paper', price: 32_000, quantity: 4, status: 'disputed' },
  ] as const) {
    const orderRequest: PurchaseRequest = { ...request, id: `demo-request-${example.slug}`,
      draft: { ...request.draft, product: example.product, quantity: example.quantity, budgetCents: null, notes: '', category: 'Supplies' },
      status: 'accepted', supplierIds: [supplier], matches: [] };
    await save(db, tables.requests, orderRequest.id, orderRequest, { company_id: buyer });
    const quote: Quote = { id: `demo-quote-${example.slug}`, requestId: orderRequest.id, supplierId: supplier,
      listingId: example.listingId, version: 1, quantity: example.quantity, unitPriceCents: example.price, taxCents: 0,
      deliveryFeeCents: 15_000, totalCents: example.price * example.quantity + 15_000, currency: 'ZAR', deliveryDate: dateIn(0),
      expiresAt: at, notes: '', status: 'accepted', createdAt: at };
    await save(db, tables.quotes, quote.id, quote, { request_id: orderRequest.id, company_id: supplier, listing_id: quote.listingId, version: 1 });
    const done = example.status === 'completed';
    const order: Order = { id: `demo-order-${example.slug}`, reference: done ? 'SP-1042' : 'SP-1049',
      quoteId: quote.id, requestId: orderRequest.id, buyerId: buyer, supplierId: supplier,
      product: example.product, unit: 'cases', quantity: quote.quantity, unitPriceCents: quote.unitPriceCents,
      totalCents: quote.totalCents, taxCents: 0, deliveryFeeCents: quote.deliveryFeeCents, deliveryDate: quote.deliveryDate,
      location: 'Woodstock, Cape Town', status: example.status, paymentMode: 'demo', fundedCents: quote.totalCents,
      releasedCents: done ? quote.totalCents : 0, refundedCents: 0, acceptedQuantity: done ? quote.quantity : 0,
      transactions: [{ id: `${example.slug}-fund`, kind: 'funding', mode: 'demo', status: 'confirmed', amountCents: quote.totalCents, createdAt: at }],
      messages: [], timeline: [{ title: done ? 'Demo order completed' : 'Demo delivery dispute opened', at }], createdAt: at };
    if (done) order.transactions.push({ id: 'complete-release', kind: 'release', mode: 'demo', status: 'confirmed',
      amountCents: quote.totalCents, quantity: quote.quantity, createdAt: at });
    await save(db, tables.orders, order.id, order, { company_id: buyer, supplier_id: supplier, quote_id: quote.id, request_id: orderRequest.id });
    if (!done) await save(db, tables.disputes, 'demo-dispute', { id: 'demo-dispute', orderId: order.id, openedBy: buyer,
      quantity: quote.quantity, reason: 'Cases arrived water damaged.', amountCents: quote.totalCents, status: 'open', createdAt: at }, { order_id: order.id });
  }

  await save(db, tables.notifications, 'demo-notice-quotes', { id: 'demo-notice-quotes', title: 'Two quotes ready to compare',
    body: 'Cape Supply Co. and Peninsula Wholesale quoted on your tomato request.', href: '#requests', read: false, createdAt: at }, { company_id: buyer });
}

async function seed(db: DbSession) {
  const seeded = await sql<{ ready: boolean }>`select data->>'demoSeeded' = 'true' as ready from stockpact_control where id = 'marketplace'`.execute(db);
  if (seeded.rows[0]?.ready) return;
  for (const company of companies) await save(db, tables.companies, company.id, company, { demo: true });
  for (const account of Object.values(demoAccounts)) {
    await sql`insert into "user" (id, name, email, "createdAt", "updatedAt") values
      (${account.id}, ${account.name}, ${account.email}, now(), now()) on conflict (id) do nothing`.execute(db);
    await sql`insert into memberships (id, company_id, user_id, role) values
      (${account.id}, ${account.companyId}, ${account.id}, ${account.role}) on conflict (id) do nothing`.execute(db);
  }
  for (const item of seedListings()) await save(db, tables.listings, item.id, item, { company_id: item.supplierId });
  await seedExamples(db);
  await sql`update stockpact_control set data = data || '{"demoSeeded":true}'::jsonb where id = 'marketplace'`.execute(db);
}

const cache = globalThis as typeof globalThis & { stockpactSeed?: Promise<void> };
export async function ensureDemoSeed() {
  if (!demoEnabled()) return;
  cache.stockpactSeed ??= mutate(seed).catch((error) => { delete cache.stockpactSeed; throw error; });
  return cache.stockpactSeed;
}

export async function resetDemo() {
  if (!demoEnabled() || process.env.DATABASE_URL) throw new Error('Reset is available only for the local demo database.');
  await mutate(async (db) => {
    const demoOrder = sql`order_id in (select id from orders where company_id like 'demo-%')`;
    for (const table of [tables.transactions, tables.qr, tables.disputes, tables.reviews]) {
      await sql`delete from ${sql.table(table)} where ${demoOrder}`.execute(db);
    }
    await sql`delete from inventory_movements where listing_id in (select id from listings where company_id like 'demo-%')`.execute(db);
    await sql`delete from orders where company_id like 'demo-%'`.execute(db);
    await sql`delete from jobs where request_id in (select id from purchase_requests where company_id like 'demo-%')`.execute(db);
    for (const table of [tables.team, tables.invitations, tables.quotes, tables.requests, tables.listings, tables.notifications,
      tables.preferences, tables.shopping, tables.audit, tables.wallet]) {
      await sql`delete from ${sql.table(table)} where company_id like 'demo-%'`.execute(db);
    }
    await sql`delete from memberships where company_id like 'demo-%'`.execute(db);
    await sql`delete from verification_checks where company_id like 'demo-%'`.execute(db);
    await sql`delete from companies where demo = true`.execute(db);
    await sql`update stockpact_control set data = data - 'demoSeeded' where id = 'marketplace'`.execute(db);
    await seed(db);
  });
}
