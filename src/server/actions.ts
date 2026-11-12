import { sql } from 'kysely';
import { headers } from 'next/headers';
import { z } from 'zod';
import { parsePurchaseRequest } from '../integrations/purchasing';
import { demoRoles, type Actor, type PurchaseRequest } from '../shared/marketplace';
import { actorCompany, MarketplaceError, notify, requireFound, requireRole, supplierRequest } from './access';
import { demoEnabled, getDb, mutate, record, records, tables, update, type DbSession } from './db';
import { id, listingFields, parse } from './inputs';
import * as orders from './orders';
import * as procurement from './procurement';
import * as reputation from './reputation';
import { now, resetDemo } from './seed';
import { actorForUser, applyRegistrationCookies, clearSession, demoActor, getActor, getAuth, registerCompanyAccount, selectCompany } from './session';
import * as settings from './settings';

const email = z.email().transform((value) => value.toLowerCase());
const password = z.string().min(10).max(128);
const field = (input: unknown, key: string) => parse(z.object({ [key]: id }), input)[key];

async function authActions(action: string, input: unknown): Promise<{ actor?: Actor | null; data?: unknown } | undefined> {
  switch (action) {
    case 'register': {
      const { name, companyName, email: address, password: phrase } = parse(z.object({ name: z.string().trim().min(2).max(100),
        companyName: z.string().trim().min(2).max(150), email, password }), input);
      const { actor, sessionHeaders } = await registerCompanyAccount({ name, email: address, password: phrase, companyName }, await headers());
      await applyRegistrationCookies(sessionHeaders);
      return { actor };
    }
    case 'signIn': {
      const body = parse(z.object({ email, password }), input);
      const result = await (await getAuth()).api.signInEmail({ body, headers: await headers() });
      if (!result.user) throw new MarketplaceError('Email or password is incorrect.', 401);
      return { actor: requireFound(await actorForUser(result.user), 'Your account has no company membership.') };
    }
    case 'signOut':
      await clearSession();
      return { actor: null };
    case 'switchRole': {
      if (!demoEnabled()) throw new MarketplaceError('Demo accounts are disabled.', 403);
      if ((await getActor())?.demoRole === undefined && await getActor()) throw new MarketplaceError('Sign out of your registered account first.', 403);
      const { role } = parse(z.object({ role: z.enum(demoRoles) }), input);
      return { actor: await demoActor(role) };
    }
    case 'requestPasswordReset': {
      if (!process.env.STOCKPACT_EMAIL_WEBHOOK) throw new MarketplaceError('Password recovery email is unavailable in this environment.', 503);
      const body = parse(z.object({ email }), input);
      await (await getAuth()).api.requestPasswordReset({ body: { ...body, redirectTo: '/?reset=1' }, headers: await headers() });
      return { data: { message: 'If an account exists, a recovery email has been requested.' } };
    }
    case 'resetPassword': {
      const { token, password: newPassword } = parse(z.object({ token: z.string().min(5).max(200), password }), input);
      await (await getAuth()).api.resetPassword({ body: { token, newPassword }, headers: await headers() });
      await clearSession();
      return { actor: null, data: { message: 'Password changed. Sign in with your new password.' } };
    }
  }
}

async function supplierReply(db: DbSession, actor: Actor, input: unknown, decline: boolean) {
  requireRole(actor, 'owner', 'sales');
  const { requestId, body } = parse(z.object({ requestId: id, body: z.string().trim().max(1500).optional() }), input);
  const request = await supplierRequest(db, actor, requestId);
  if (request.status !== 'sent') throw new MarketplaceError('This request is no longer open.', 409);
  if (!decline && !body) throw new MarketplaceError('Enter a question for the buyer.', 422);
  const company = await actorCompany(actor, db);
  const key = `${request.id}:${actor.companyId}`;
  const invitation = requireFound(await record<procurement.SupplierInvitation>(db, tables.invitations, key));
  if (invitation.status === 'declined') throw new MarketplaceError('This supplier already declined the request.', 409);
  await update(db, tables.invitations, key, { ...invitation, status: decline ? 'declined' : invitation.status,
    note: decline ? body : invitation.note, activity: [...(invitation.activity ?? []), { title: decline ? (body ? `Declined · ${body}` : 'Declined') : `Question sent · ${body}`, at: now() }] });
  if (decline) {
    const quotes = await records<{ id: string; status: string }>(db, tables.quotes, sql`request_id = ${requestId} and company_id = ${actor.companyId} and data->>'status' = 'submitted'`);
    for (const quote of quotes) await update(db, tables.quotes, quote.id, { ...quote, status: 'declined' });
  }
  request.activity.push({ title: decline ? `${company.name} declined the request` : `${company.name} asked: ${body}`, at: now() });
  await update(db, tables.requests, requestId, request);
  await notify(db, request.buyerId, decline ? 'Supplier declined request' : 'Supplier question', body ?? `${company.name} declined to quote.`, '#requests');
}

export async function marketplaceAction(action: string, input: unknown): Promise<{ actor?: Actor | null; data?: unknown }> {
  const authResult = await authActions(action, input);
  if (authResult) return authResult;
  const actor = await getActor();
  if (!actor) throw new MarketplaceError('Sign in to continue.', 401);
  if (action === 'switchCompany') return { actor: requireFound(await selectCompany(actor, field(input, 'companyId'))) };
  if (action === 'draftRequest') {
    requireRole(actor, 'owner', 'purchaser');
    const { prompt } = parse(z.object({ prompt: z.string().trim().min(3).max(3500) }), input);
    return { data: await parsePurchaseRequest(prompt) };
  }
  if (action === 'resetDemo') {
    if (actor.demoRole !== 'admin') throw new MarketplaceError('Switch to the demo reviewer to reset the local demo.', 403);
    await resetDemo();
    return {};
  }
  const data = await mutate(async (db) => {
    switch (action) {
      case 'createRequest': return procurement.createRequest(db, actor, input);
      case 'matchRequest': return procurement.enqueueMatch(db, actor, field(input, 'requestId'));
      case 'sendRequest': return procurement.sendRequest(db, actor, input);
      case 'submitQuote': return procurement.submitQuote(db, actor, input);
      case 'acceptQuote': return procurement.acceptQuote(db, actor, field(input, 'quoteId'));
      case 'declineRequest': return supplierReply(db, actor, input, true);
      case 'askRequest': return supplierReply(db, actor, input, false);
      case 'saveListing': return procurement.saveListing(db, actor, input);
      case 'importListings': {
        const { listings } = parse(z.object({ listings: z.array(listingFields).min(1).max(100) }), input);
        const imported = [];
        for (const listing of listings) imported.push(await procurement.saveListing(db, actor, { listing }));
        return imported;
      }
      case 'archiveListing': {
        const listingId = field(input, 'listingId');
        const listing = requireFound((await records<object>(db, tables.listings, sql`id = ${listingId} and company_id = ${actor.companyId}`))[0]);
        return procurement.saveListing(db, actor, { listing: { ...listing, archived: true } });
      }
      case 'approveOrder': return orders.approveOrder(db, actor, field(input, 'orderId'));
      case 'prepareFunding': return orders.prepareFunding(db, actor, field(input, 'orderId'));
      case 'fundOrder': return orders.fundOrder(db, actor, input);
      case 'dispatchOrder': return orders.dispatchOrder(db, actor, field(input, 'orderId'));
      case 'assignDriver': return orders.assignDriver(db, actor, input);
      case 'authorizeDelivery': return orders.authorizeDelivery(db, actor, input);
      case 'inspectDelivery': return orders.inspectDelivery(db, actor, input);
      case 'signDelivery': return orders.signDelivery(db, actor, input);
      case 'redeemDelivery': return orders.redeemDelivery(db, actor, input);
      case 'cancelDelivery': return orders.cancelDelivery(db, actor, input);
      case 'cancelOrder': return orders.cancelOrder(db, actor, field(input, 'orderId'));
      case 'reviewOrder': return orders.reviewOrder(db, actor, input);
      case 'replyReview': return reputation.replyReview(db, actor, input);
      case 'reportReview': return reputation.reportReview(db, actor, input);
      case 'moderateReview': return reputation.moderateReview(db, actor, input);
      case 'reorder': return orders.reorder(db, actor, field(input, 'orderId'));
      case 'postMessage': return orders.postMessage(db, actor, input);
      case 'openDispute': return orders.openDispute(db, actor, input);
      case 'resolveDispute': return orders.resolveDispute(db, actor, input);
      case 'toggleFavorite': return settings.preference(db, actor, field(input, 'listingId'), 'favorites');
      case 'preferSupplier': return settings.preference(db, actor, field(input, 'supplierId'), 'preferredSuppliers');
      case 'readNotification': return settings.readNotification(db, actor, field(input, 'notificationId'));
      case 'saveShoppingList': return settings.saveShoppingList(db, actor, input);
      case 'updateCompany': return settings.updateCompany(db, actor, input);
      case 'submitVerification': return settings.submitVerification(db, actor);
      case 'reviewVerification': return settings.reviewVerification(db, actor, input);
      case 'walletChallenge': return settings.walletChallenge(db, actor, input);
      case 'setWallet': return settings.setWallet(db, actor, input);
      case 'inviteMember': return settings.inviteMember(db, actor, input);
      case 'acceptInvitation': return settings.acceptInvitation(db, actor, input);
      default: throw new MarketplaceError('This action is unavailable.', 404);
    }
  });
  return { data };
}

export async function recoverJobs(actor: Actor | null) {
  if (!actor || !['owner', 'purchaser'].includes(actor.role)) return;
  const pending = await records<PurchaseRequest>(await getDb(), tables.requests, sql`company_id = ${actor.companyId} and data->>'status' = 'matching' limit 1`);
  if (pending.length) await procurement.runMatchingJobs(actor.companyId);
}
