import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { escrowStatus, verifyWalletProof, type WalletProof } from '../integrations/escrow/server';
import { walletAddress } from '../integrations/escrow/shared';
import { initialMarket, type Actor, type Company, type Listing, type Notice, type ShoppingList, type VerificationCheck } from '../shared/marketplace';
import { actorCompany, audit, MarketplaceError, requireFound, requireRole } from './access';
import { record, records, save, tables, update, type DbSession } from './db';
import { cents, date, draft, id, parse } from './inputs';
import { addMembership } from './session';
import { defaultPreferences, type Preferences } from './state';

export async function updateCompany(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner');
  const { company: fields } = parse(z.object({ company: z.object({
    name: z.string().trim().min(2).max(150), legalName: z.string().trim().min(2).max(150),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    location: z.string().trim().min(2).max(250), registrationNumber: z.string().trim().max(80).optional(),
    contact: z.string().trim().max(200).optional(), representative: z.string().trim().max(150).optional(),
    capabilities: z.array(z.enum(['buyer', 'supplier', 'delivery'])).min(1).max(3), approvalThresholdCents: cents.nullable().optional(),
  }) }), input);
  const company = await actorCompany(actor, db);
  if (fields.country !== initialMarket.country || (fields.currency && fields.currency !== initialMarket.currency)) {
    throw new MarketplaceError('This marketplace currently supports South African companies and rand quotations.', 422);
  }
  const updated: Company = { ...company, ...fields, verification: { ...company.verification }, capabilities: [...new Set(fields.capabilities)] };
  if (!company.demo) {
    const identityChanged = company.legalName !== fields.legalName || company.registrationNumber !== fields.registrationNumber ||
      company.country !== fields.country || company.location !== fields.location;
    const scopes: VerificationCheck['scope'][] = identityChanged ? ['business', 'representative', 'delivery']
      : company.representative !== fields.representative ? ['representative'] : [];
    if (scopes.length) {
      for (const scope of scopes) updated.verification[scope] = 'unsubmitted';
      updated.verificationNote = undefined;
      await sql`delete from persona_inquiries where company_id = ${company.id} and scope in (${sql.join(scopes)})`.execute(db);
    }
  }
  await update(db, tables.companies, company.id, updated);
  await audit(db, actor, 'update_company', company.id);
  return updated;
}

export async function submitVerification(db: DbSession, actor: Actor) {
  requireRole(actor, 'owner');
  const company = await actorCompany(actor, db);
  if (!company.demo && (!company.registrationNumber || !company.location || !company.representative)) {
    throw new MarketplaceError('Complete the company registration, address and representative fields first.', 422);
  }
  const verification = { ...company.verification };
  const applicable: VerificationCheck['scope'][] = ['business', 'representative'];
  if (company.capabilities.includes('delivery')) applicable.push('delivery');
  const scopes = applicable.filter((scope) => company.demo || !['verified', 'pending'].includes(verification[scope]));
  if (!scopes.length) throw new MarketplaceError('All applicable checks are approved or already under review.', 409);
  for (const scope of scopes) verification[scope] = 'pending';
  const updated = { ...company, verification, verificationNote: undefined };
  await update(db, tables.companies, company.id, updated);
  for (const scope of scopes) await recordVerification(db, { actorId: actor.id, companyId: company.id, scope, status: 'pending', provider: company.demo ? 'demo' : 'manual' });
  await audit(db, actor, 'submit_verification', company.id);
  return updated;
}

export async function reviewVerification(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'reviewer');
  const { companyId, scope, status, note } = parse(z.object({ companyId: id,
    scope: z.enum(['business', 'representative', 'delivery']), status: z.enum(['pending', 'action_required', 'verified', 'rejected', 'expired']),
    note: z.string().trim().max(1600).default(''),
  }), input);
  const company = requireFound((await records<Company>(db, tables.companies, sql`id = ${companyId} and demo = ${Boolean(actor.demoRole)}`))[0]);
  if (company.id === actor.companyId) throw new MarketplaceError('Reviewers cannot verify their own company.', 403);
  const updated = { ...company, verification: { ...company.verification, [scope]: status }, verificationNote: note };
  await update(db, tables.companies, company.id, updated);
  await recordVerification(db, { actorId: actor.id, companyId, scope, status, note, provider: company.demo ? 'demo' : 'manual' });
  await audit(db, actor, 'review_verification', company.id);
  return updated;
}

export async function recordVerification(db: DbSession, values: Omit<VerificationCheck, 'id' | 'createdAt' | 'note'> & {
  actorId?: string; providerReference?: string; note?: string;
}) {
  await sql`insert into verification_checks (id, company_id, scope, status, actor_id, provider, provider_reference, note)
    values (${randomUUID()}, ${values.companyId}, ${values.scope}, ${values.status}, ${values.actorId ?? null},
      ${values.provider}, ${values.providerReference ?? null}, ${values.note ?? ''})`.execute(db);
}

export async function preference(db: DbSession, actor: Actor, target: string, type: 'favorites' | 'preferredSuppliers') {
  const key = `${actor.companyId}:${actor.id}`;
  const listing = type === 'favorites' ? requireFound(await record<Listing>(db, tables.listings, target)) : null;
  const company = requireFound(await record<Company>(db, tables.companies, listing?.supplierId ?? target));
  if (company.demo !== Boolean(actor.demoRole) || company.verification.business !== 'verified') throw new MarketplaceError('That supplier is unavailable.', 404);
  const data = await record<Preferences>(db, tables.preferences, key) ?? defaultPreferences();
  data[type] = data[type].includes(target) ? data[type].filter((item) => item !== target) : [...data[type], target];
  await save(db, tables.preferences, key, data, { company_id: actor.companyId });
  return data;
}

export async function saveShoppingList(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'purchaser');
  const { name, items, remindAt } = parse(z.object({ name: z.string().trim().min(2).max(100), items: z.array(draft).min(1).max(40), remindAt: date.optional() }), input);
  const list: ShoppingList = { id: randomUUID(), name, items, remindAt };
  await save(db, tables.shopping, list.id, list, { company_id: actor.companyId });
  return list;
}

export async function readNotification(db: DbSession, actor: Actor, notificationId: string) {
  if (actor.role === 'driver') throw new MarketplaceError('This notification is not available to drivers.', 403);
  const notice = requireFound((await records<Notice>(db, tables.notifications, sql`id = ${notificationId} and company_id = ${actor.companyId}`))[0]);
  await update(db, tables.notifications, notice.id, { ...notice, read: true });
}

type StoredWalletProof = WalletProof & { challenge: string; expiresAt: string; used: boolean };
export async function walletChallenge(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner');
  if (escrowStatus().mode !== 'testnet') throw new MarketplaceError('Wallet registration is available in testnet mode.', 422);
  const { address } = parse(z.object({ address: z.string().regex(/^0x[\da-f]{40}$/i).refine((value) => !/^0x0{40}$/i.test(value)) }), input);
  const challenge = randomBytes(32).toString('hex');
  const proof: StoredWalletProof = { address: walletAddress(address), companyId: actor.companyId, userId: actor.id, challenge,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), used: false };
  await save(db, tables.wallet, challenge, proof, { company_id: actor.companyId });
  return { address: proof.address, companyId: proof.companyId, userId: proof.userId, challenge: proof.challenge, expiresAt: proof.expiresAt };
}

export async function setWallet(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner');
  const { challenge, signature } = parse(z.object({ challenge: z.string().regex(/^[\da-f]{64}$/), signature: z.string().regex(/^0x[\da-f]{130}$/i) }), input);
  const proof = requireFound((await records<StoredWalletProof>(db, tables.wallet, sql`id = ${challenge} and company_id = ${actor.companyId}`))[0]);
  if (proof.used || proof.userId !== actor.id || !await verifyWalletProof({ ...proof, signature })) throw new MarketplaceError('Wallet proof expired or the signature is invalid.', 422);
  const company = await actorCompany(actor, db);
  const updated = { ...company, wallet: walletAddress(proof.address) };
  await update(db, tables.companies, company.id, updated);
  await update(db, tables.wallet, challenge, { ...proof, used: true });
  await audit(db, actor, 'link_wallet', company.id);
  return updated;
}

type Invitation = { email: string; role: 'purchaser' | 'approver' | 'sales' | 'driver'; expiresAt: string; companyId: string; used: boolean };
export async function inviteMember(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner');
  if (actor.demoRole) throw new MarketplaceError('Demo team members are seeded. Register a company to invite real team members.', 422);
  const values = parse(z.object({ email: z.email().transform((value) => value.toLowerCase()), role: z.enum(['purchaser', 'approver', 'sales', 'driver']) }), input);
  const code = randomBytes(32).toString('hex');
  const invite: Invitation = { ...values, companyId: actor.companyId, expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), used: false };
  await save(db, tables.team, code, invite, { company_id: actor.companyId });
  await audit(db, actor, 'invite_member', actor.companyId);
  return { code, expiresAt: invite.expiresAt, email: invite.email };
}

export async function acceptInvitation(db: DbSession, actor: Actor, input: unknown) {
  if (actor.demoRole) throw new MarketplaceError('Sign in to a registered account to accept an invitation.', 403);
  const { code } = parse(z.object({ code: z.string().regex(/^[\da-f]{64}$/i) }), input);
  const invite = requireFound(await record<Invitation>(db, tables.team, code));
  if (invite.email !== actor.email.toLowerCase() || invite.used || Date.parse(invite.expiresAt) <= Date.now()) {
    throw new MarketplaceError('The invitation is expired, already used, or belongs to another email.', 422);
  }
  await addMembership(db, invite.companyId, actor.id, invite.role);
  await update(db, tables.team, code, { ...invite, used: true });
  await audit(db, actor, 'accept_invitation', invite.companyId);
}
