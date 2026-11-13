import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { applySetCookies } from 'better-auth/cookies';
import { sql } from 'kysely';
import { getDb } from '../src/server/db';
import { actorForUser, getAuth, registerCompanyAccount } from '../src/server/session';

let directory: string;
const input = { name: 'Naledi Test', email: 'naledi.registration@example.test', password: 'local-only-test-passphrase', companyName: 'Atomic Workspace' };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stockpact-registration-'));
  delete process.env.DATABASE_URL;
  delete process.env.STOCKPACT_EMAIL_WEBHOOK;
  process.env.STOCKPACT_DB_PATH = join(directory, 'db');
  process.env.STOCKPACT_DEMO = 'true';
  process.env.BETTER_AUTH_URL = 'https://stockpact.example.test';
  process.env.BETTER_AUTH_SECRET = 'isolated-registration-test-with-a-dedicated-secret';
});

after(async () => {
  if (!directory) return;
  await (await getDb()).destroy();
  await rm(directory, { recursive: true, force: true });
});

test('a failed workspace insert rolls back signup, then retry commits one owner and secure session', async () => {
  const db = await getDb();
  await sql`alter table companies add constraint reject_test_workspace check (data->>'name' <> 'Atomic Workspace')`.execute(db);
  await assert.rejects(registerCompanyAccount(input, new Headers()), /reject_test_workspace/);
  const remaining = await sql`select id from "user" where email = ${input.email}`.execute(db);
  assert.equal(remaining.rows.length, 0);
  assert.equal((await sql`select id from session`.execute(db)).rows.length, 0);

  await sql`alter table companies drop constraint reject_test_workspace`.execute(db);
  const { actor, sessionHeaders } = await registerCompanyAccount(input, new Headers());
  assert.equal(actor.role, 'owner');
  assert.equal(actor.memberships.length, 1);
  const cookies = sessionHeaders.getSetCookie();
  assert.ok(cookies.some((cookie) => /__Secure-better-auth\.session_token=.*;.*Secure/i.test(cookie)));
  const requestHeaders = new Headers();
  applySetCookies(requestHeaders, cookies);
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  assert.ok(session);
  assert.equal(session.user.id, actor.id);
  assert.deepEqual(await actorForUser(session.user), actor);
});
