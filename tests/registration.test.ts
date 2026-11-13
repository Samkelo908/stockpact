import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { applySetCookies } from 'better-auth/cookies';
import { sql } from 'kysely';
import { getDb, mutate } from '../src/server/db';
import { actorForUser, getAuth, registerCompanyAccount } from '../src/server/session';
import { acceptInvitation, inviteMember, removeTeamMember } from '../src/server/settings';

let directory: string;
const input = { name: 'Naledi Test', email: 'naledi.registration@example.test', password: 'local-only-test-passphrase', companyName: 'Atomic Workspace' };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stockpact-registration-'));
  delete process.env.DATABASE_URL;
  process.env.STOCKPACT_EMAIL_WEBHOOK = 'https://account-mail.example.test/stockpact';
  process.env.STOCKPACT_DB_PATH = join(directory, 'db');
  process.env.STOCKPACT_DEMO = 'true';
  process.env.BETTER_AUTH_URL = 'https://stockpact.example.test';
  process.env.BETTER_AUTH_SECRET = 'isolated-registration-test-with-a-dedicated-secret';
});

test('invited staff verify their email before joining and lose company access when removed', async (t) => {
  const company = await registerCompanyAccount({ ...input, email: 'owner@example.test', companyName: 'Staff Access' }, new Headers());
  const staff = await registerCompanyAccount({ ...input, email: 'staff@example.test', companyName: 'Staff Workspace' }, new Headers());
  const invite = await mutate((db) => inviteMember(db, company.actor, { email: staff.actor.email, role: 'sales' }));
  await assert.rejects(mutate((db) => acceptInvitation(db, staff.actor, invite)), /verify your account email/i);

  let verification: URL | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    assert.equal(url, process.env.STOCKPACT_EMAIL_WEBHOOK);
    const message = JSON.parse(String(options?.body));
    assert.equal(message.to, staff.actor.email);
    assert.equal(message.type, 'email_verification');
    verification = new URL(message.url);
    return new Response(null, { status: 204 });
  });
  const auth = await getAuth();
  const headers = new Headers();
  applySetCookies(headers, staff.sessionHeaders.getSetCookie());
  await auth.api.sendVerificationEmail({ body: { email: staff.actor.email }, headers });
  const token = verification?.searchParams.get('token');
  assert.ok(token);
  await auth.api.verifyEmail({ query: { token } });
  await mutate((db) => acceptInvitation(db, staff.actor, invite));
  assert.equal((await actorForUser(staff.actor, company.actor.companyId))?.role, 'sales');
  await mutate((db) => removeTeamMember(db, company.actor, { memberId: staff.actor.id }));
  assert.equal((await actorForUser(staff.actor, company.actor.companyId))?.companyId, staff.actor.companyId);
  await assert.rejects(mutate((db) => acceptInvitation(db, staff.actor, invite)), /already used/i);
  await assert.rejects(mutate((db) => removeTeamMember(db, company.actor, { memberId: company.actor.id })), /choose a staff member/i);
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
  assert.equal((await sql`select s.id from session s join "user" u on u.id = s."userId" where u.email = ${input.email}`.execute(db)).rows.length, 0);

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
