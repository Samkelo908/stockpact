import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { initialMarket, type Company } from '../src/shared/marketplace';
import { getDb, mutate, record, save, tables } from '../src/server/db';

const email = z.email().safeParse(process.argv[2]?.trim().toLowerCase());
const workspaceId = 'stockpact-platform-reviewers';

async function main() {
  if (process.env.STOCKPACT_DEMO !== 'false' || !process.env.DATABASE_URL) {
    throw new Error('Set STOCKPACT_DEMO=false and DATABASE_URL for the intended PostgreSQL database.');
  }
  if (!email.success) throw new Error('Pass the email address of an existing, trusted StockPact user.');
  const db = await getDb();
  try {
    await mutate(async (transaction) => {
      const { rows: [user] } = await sql<{ id: string }>`select id from "user" where lower(email) = ${email.data}
        and exists (select 1 from memberships where user_id = "user".id)`.execute(transaction);
      if (!user) throw new Error('No registered StockPact user has that email address.');
      const workspace = await record<Company>(transaction, tables.companies, workspaceId);
      if (!workspace) {
        await save(transaction, tables.companies, workspaceId, {
          id: workspaceId, ...initialMarket, name: 'StockPact platform', legalName: 'StockPact platform', location: '',
          capabilities: [], verification: { business: 'unsubmitted', representative: 'unsubmitted', delivery: 'unsubmitted' }, demo: false,
        } satisfies Company, { demo: false });
      }
      await sql`insert into memberships (id, company_id, user_id, role)
        values (${randomUUID()}, ${workspaceId}, ${user.id}, 'reviewer')
        on conflict (company_id, user_id) do update set role = 'reviewer'`.execute(transaction);
    });
    console.log('Reviewer access is ready. Sign in and select the StockPact platform workspace.');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Reviewer setup failed.');
  process.exitCode = 1;
});
