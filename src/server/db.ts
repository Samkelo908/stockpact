import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';

export type Database = Kysely<Record<string, never>>;
export type DbSession = Database | Transaction<Record<string, never>>;
const host = globalThis as typeof globalThis & { stockpactDb?: Promise<Database> };

export function demoEnabled() {
  return process.env.STOCKPACT_DEMO === 'true' ||
    (process.env.STOCKPACT_DEMO !== 'false' && process.env.NODE_ENV !== 'production');
}

async function connect(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (!url && !demoEnabled() && process.env.NODE_ENV === 'production') {
    throw new Error('Configure DATABASE_URL or explicitly enable the local StockPact demo.');
  }
  const localPath = resolve(/* turbopackIgnore: true */ process.env.STOCKPACT_DB_PATH ?? '.stockpact/db');
  if (!url) await mkdir(localPath, { recursive: true });
  const dialect = url
    ? new PostgresDialect({ pool: new Pool({ connectionString: url, max: 8 }) })
    : new PGliteDialect({ pglite: () => PGlite.create(localPath) });
  const db = new Kysely<Record<string, never>>({ dialect });
  const migrationDir = join(process.cwd(), 'db/migrations');
  const migrations = (await readdir(migrationDir)).filter((entry) => /^\d+_[\w]+\.sql$/.test(entry)).sort();
  await db.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(917325101)`.execute(transaction);
    await sql`create table if not exists stockpact_migrations (name text primary key, applied_at timestamptz not null default now())`.execute(transaction);
    for (const name of migrations) {
      const existing = await sql`select name from stockpact_migrations where name = ${name}`.execute(transaction);
      if (existing.rows.length) continue;
      const migration = await readFile(join(migrationDir, name), 'utf8');
      for (const statement of migration.split(';').map((item) => item.trim()).filter(Boolean)) {
        await sql.raw(statement).execute(transaction);
      }
      await sql`insert into stockpact_migrations (name) values (${name})`.execute(transaction);
    }
  });
  return db;
}

export function getDb() {
  host.stockpactDb ??= connect().catch((error) => {
    delete host.stockpactDb;
    throw error;
  });
  return host.stockpactDb;
}

export async function mutate<T>(operation: (db: DbSession) => Promise<T>): Promise<T> {
  return (await getDb()).transaction().execute(async (db) => {
    await sql`select id from stockpact_control where id = 'marketplace' for update`.execute(db);
    return operation(db);
  });
}

export const tables = {
  companies: 'companies', listings: 'listings', requests: 'purchase_requests', quotes: 'quotes',
  orders: 'orders', qr: 'qr_authorizations', transactions: 'settlement_refs',
  invitations: 'supplier_invitations', movements: 'inventory_movements', notifications: 'notifications',
  reviews: 'reviews', disputes: 'disputes', preferences: 'company_preferences',
  shopping: 'shopping_lists', jobs: 'jobs', audit: 'audit_events', wallet: 'wallet_challenges',
  team: 'team_invitations',
} as const;
type Table = (typeof tables)[keyof typeof tables];

export async function records<T>(db: DbSession, table: Table, where = sql`true`): Promise<T[]> {
  const result = await sql<{ data: T }>`select data from ${sql.table(table)} where ${where}`.execute(db);
  return result.rows.map(({ data }) => data);
}

export async function record<T>(db: DbSession, table: Table, id: string): Promise<T | undefined> {
  return (await records<T>(db, table, sql`id = ${id}`))[0];
}

export async function save<T extends object>(db: DbSession, table: Table, id: string, data: T,
  relations: Record<string, string | number | boolean> = {}) {
  const keys = ['id', 'data', ...Object.keys(relations)];
  const values = [sql`${id}`, sql`${JSON.stringify(data)}::jsonb`, ...Object.values(relations).map((value) => sql`${value}`)];
  await sql`insert into ${sql.table(table)} (${sql.join(keys.map((key) => sql.ref(key)))})
    values (${sql.join(values)}) on conflict (id) do update set data = excluded.data`.execute(db);
}

export async function update<T extends object>(db: DbSession, table: Table, id: string, data: T) {
  await sql`update ${sql.table(table)} set data = ${JSON.stringify(data)}::jsonb where id = ${id}`.execute(db);
}

export async function actionLimit(key: string, maximum: number, minutes: number) {
  const db = await getDb();
  const expiry = new Date(Date.now() + minutes * 60_000);
  const result = await sql<{ attempts: number }>`
    insert into action_limits (id, attempts, expires_at) values (${key}, 1, ${expiry})
    on conflict (id) do update set
      attempts = case when action_limits.expires_at < now() then 1 else action_limits.attempts + 1 end,
      expires_at = case when action_limits.expires_at < now() then excluded.expires_at else action_limits.expires_at end
    returning attempts`.execute(db);
  return result.rows[0].attempts <= maximum;
}
