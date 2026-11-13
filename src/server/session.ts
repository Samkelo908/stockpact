import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { getSessionCookie, parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { nextCookies } from 'better-auth/next-js';
import { sql } from 'kysely';
import { cookies, headers } from 'next/headers';
import { after } from 'next/server';
import { demoEnabled, getDb, save, tables, type DbSession } from './db';
import { demoAccounts, ensureDemoSeed } from './seed';
import { demoRoles, initialMarket, type Actor, type Company, type CompanyRole, type DemoRole } from '../shared/marketplace';

const demoCookie = 'stockpact-demo';
const companyCookie = 'stockpact-company';
const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 } as const;

function authOrigin() {
  const production = process.env.NODE_ENV === 'production' && !demoEnabled();
  if (production && ((process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32 || !process.env.BETTER_AUTH_URL)) {
    throw new Error('Configure BETTER_AUTH_SECRET and BETTER_AUTH_URL.');
  }
  const url = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && (url.protocol !== 'http:' || (production && !loopback)))) {
    throw new Error('Set BETTER_AUTH_URL to the application origin. Use HTTPS outside local development.');
  }
  return url;
}

function createAuth(database: DbSession, registrationTransaction = false) {
  const origin = authOrigin();
  const resetUrl = process.env.STOCKPACT_EMAIL_WEBHOOK;
  return betterAuth({
    database: { db: database, type: 'postgres', transaction: !registrationTransaction },
    baseURL: origin.origin,
    secret: process.env.BETTER_AUTH_SECRET ?? 'stockpact-local-development-only-not-a-production-secret',
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      ...(resetUrl ? {
        resetPasswordTokenExpiresIn: 1800,
        sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
          try {
            const response = await fetch(resetUrl, {
              method: 'POST', headers: { 'content-type': 'application/json',
                ...(process.env.STOCKPACT_EMAIL_SECRET ? { authorization: `Bearer ${process.env.STOCKPACT_EMAIL_SECRET}` } : {}) },
              body: JSON.stringify({ type: 'password_reset', to: user.email, url }),
              redirect: 'error', signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error();
          } catch {
            console.error('StockPact password recovery delivery failed.');
          }
        },
      } : {}),
    },
    advanced: {
      useSecureCookies: origin.protocol === 'https:',
      // The scoped adapter uses the caller's transaction and cannot open a connection for schema introspection.
      database: { validateSchema: !registrationTransaction },
      backgroundTasks: { handler: (task) => { after(() => task); } },
    },
    telemetry: { enabled: false },
    rateLimit: { enabled: true, storage: 'database' },
    plugins: registrationTransaction ? [] : [nextCookies()],
  });
}

const authCache = globalThis as typeof globalThis & { stockpactAuth?: ReturnType<typeof createAuth> };
export async function getAuth() {
  authCache.stockpactAuth ??= createAuth(await getDb());
  return authCache.stockpactAuth;
}

export async function actorForUser(user: { id: string; name: string; email: string }, selectedCompanyId?: string): Promise<Actor | null> {
  const db = await getDb();
  const result = await sql<Actor['memberships'][number]>`select m.company_id as "companyId", c.data->>'name' as "companyName", m.role
    from memberships m join companies c on c.id = m.company_id where m.user_id = ${user.id} and c.demo = false
    order by m.id`.execute(db);
  const membership = result.rows.find(({ companyId }) => companyId === selectedCompanyId) ?? result.rows[0];
  if (!membership) return null;
  return { id: user.id, name: user.name, email: user.email, companyId: membership.companyId, role: membership.role, memberships: result.rows };
}

export async function getActor(): Promise<Actor | null> {
  const [requestHeaders, jar] = await Promise.all([headers(), cookies()]);
  if (getSessionCookie(requestHeaders)) {
    const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
    if (session) return actorForUser(session.user, jar.get(companyCookie)?.value);
  }
  if (!demoEnabled()) return null;
  const selection = jar.get(demoCookie)?.value ?? 'buyer';
  if (selection === 'signed-out') return null;
  await ensureDemoSeed();
  const role = demoRoles.includes(selection as DemoRole) ? selection as DemoRole : 'buyer';
  const user = demoAccounts[role];
  const label = await sql<{ name: string }>`select data->>'name' as name from companies where id = ${user.companyId}`.execute(await getDb());
  return { ...user, memberships: [{ companyId: user.companyId, companyName: label.rows[0].name, role: user.role }] };
}

export async function demoActor(role: DemoRole) {
  const jar = await cookies();
  jar.set(demoCookie, role, cookieOptions);
  return getActor();
}

export async function selectCompany(actor: Actor, companyId: string) {
  const membership = actor.memberships.find((entry) => entry.companyId === companyId);
  if (!membership) return null;
  (await cookies()).set(companyCookie, companyId, { ...cookieOptions, secure: authOrigin().protocol === 'https:' });
  return { ...actor, companyId, role: membership.role };
}

export async function registerCompanyAccount(input: { name: string; email: string; password: string; companyName: string }, requestHeaders: Headers) {
  const { companyName, ...body } = input;
  return (await getDb()).transaction().execute(async (db) => {
    const { response, headers: sessionHeaders } = await createAuth(db, true).api.signUpEmail({ body, headers: requestHeaders, returnHeaders: true });
    const companyId = randomUUID();
    const company: Company = { id: companyId, name: companyName, legalName: companyName, ...initialMarket, location: '', contact: body.email,
      capabilities: ['buyer'], verification: { business: 'unsubmitted', representative: 'unsubmitted', delivery: 'unsubmitted' }, demo: false };
    const { id, name, email } = response.user;
    await save(db, tables.companies, companyId, company, { demo: false });
    await addMembership(db, companyId, id, 'owner');
    const actor: Actor = { id, name, email, companyId, role: 'owner', memberships: [{ companyId, companyName, role: 'owner' }] };
    return { actor, sessionHeaders };
  });
}

export async function applyRegistrationCookies(sessionHeaders: Headers) {
  const jar = await cookies();
  for (const [name, attributes] of parseSetCookieHeader(sessionHeaders.get('set-cookie') ?? '')) {
    jar.set(name, attributes.value, toCookieOptions(attributes));
  }
}

export async function addMembership(db: DbSession, companyId: string, userId: string, role: CompanyRole) {
  await sql`insert into memberships (id, company_id, user_id, role) values (${randomUUID()}, ${companyId}, ${userId}, ${role})
    on conflict (company_id, user_id) do nothing`.execute(db);
}

export async function clearSession() {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  if (getSessionCookie(requestHeaders)) {
    await (await getAuth()).api.signOut({ headers: requestHeaders });
  }
  jar.set(demoCookie, 'signed-out', cookieOptions);
  jar.delete(companyCookie);
}
