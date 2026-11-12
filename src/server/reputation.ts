import { sql } from 'kysely';
import { z } from 'zod';
import type { Actor, Review } from '../shared/marketplace';
import { audit, MarketplaceError, notify, requireFound, requireRole } from './access';
import { records, tables, update, type DbSession } from './db';
import { id, parse } from './inputs';
import { now } from './seed';

type ModeratedReview = Review & {
  reply?: { body: string; at: string };
  reported?: boolean;
  hidden?: boolean;
  moderationNote?: string;
};

async function realmReview(db: DbSession, actor: Actor, reviewId: string) {
  return requireFound((await records<ModeratedReview>(db, tables.reviews, sql`id = ${reviewId} and company_id in (
    select id from companies where demo = ${Boolean(actor.demoRole)} and (id = ${actor.companyId} or
      data->'verification'->>'business' = 'verified' or ${actor.role === 'reviewer'})
  )`))[0], 'Review was not found.');
}

export async function replyReview(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'sales');
  const { reviewId, body } = parse(z.object({ reviewId: id, body: z.string().trim().min(2).max(1500) }), input);
  const review = await realmReview(db, actor, reviewId);
  if (review.supplierId !== actor.companyId || review.hidden) throw new MarketplaceError('This review is unavailable to reply to.', 403);
  const updated = { ...review, reply: { body, at: now() } };
  await update(db, tables.reviews, reviewId, updated);
  await audit(db, actor, 'reply_review', reviewId);
  await notify(db, review.buyerId, 'Supplier replied to your review', 'Open Reviews to read the supplier reply.', '#reviews');
  return updated;
}

export async function reportReview(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'owner', 'sales', 'purchaser', 'approver');
  const { reviewId, reason } = parse(z.object({ reviewId: id, reason: z.string().trim().min(4).max(1400) }), input);
  const review = await realmReview(db, actor, reviewId);
  if (review.hidden) throw new MarketplaceError('This review was already hidden.', 409);
  await update(db, tables.reviews, reviewId, { ...review, reported: true });
  await audit(db, actor, 'report_review', reviewId, { reason });
  return { reviewId, reported: true };
}

export async function moderateReview(db: DbSession, actor: Actor, input: unknown) {
  requireRole(actor, 'reviewer');
  const { reviewId, hidden, note } = parse(z.object({ reviewId: id, hidden: z.boolean(), note: z.string().trim().min(4).max(1400) }), input);
  const review = await realmReview(db, actor, reviewId);
  const updated = { ...review, hidden, reported: false, moderationNote: note };
  await update(db, tables.reviews, reviewId, updated);
  await audit(db, actor, 'moderate_review', reviewId, { hidden, note });
  return updated;
}
