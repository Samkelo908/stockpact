import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { decideXrplHandover } from '@/integrations/purchasing';
import { MarketplaceError } from '@/server/access';
import { marketplaceAction } from '@/server/actions';
import { actionLimit } from '@/server/db';
import { apiError, json, readRequestBody, requireSameOrigin } from '@/server/http';
import { runMatchingJobs } from '@/server/procurement';
import { getActor } from '@/server/session';
import { marketplaceState } from '@/server/state';
import { runXrplJobs } from '@/server/xrpl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new MarketplaceError('Send a JSON request.', 415);
    }
    const body = await (await readRequestBody(request, 300_000)).text();
    let input: unknown;
    try { input = JSON.parse(body); }
    catch { throw new MarketplaceError('Enter a valid JSON request.', 400); }
    if (!input || typeof input !== 'object' || !('action' in input) || typeof input.action !== 'string' || input.action.length > 50) {
      throw new MarketplaceError('Choose a StockPact action.', 400);
    }
    const action = input.action;
    if (['register', 'signIn', 'requestPasswordReset', 'resetPassword', 'draftRequest'].includes(action)) {
      const actor = action === 'draftRequest' ? await getActor() : null;
      const key = actor?.id ?? request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
      const digest = createHash('sha256').update(`${action}:${key.slice(0, 120)}`).digest('hex');
      if (!await actionLimit(digest, action === 'draftRequest' ? 25 : 12, 10)) throw new MarketplaceError('Too many attempts. Try again in ten minutes.', 429);
    }
    const result = await marketplaceAction(action, input);
    const actor = 'actor' in result ? result.actor ?? null : await getActor();
    if (action === 'matchRequest' && actor) after(async () => { await runMatchingJobs(actor.companyId); });
    if (actor && (action === 'redeemDelivery' || action === 'retryXrplPayment') && result.data &&
        typeof result.data === 'object' && 'xrplAttemptId' in result.data && typeof result.data.xrplAttemptId === 'string') {
      const attemptId = result.data.xrplAttemptId;
      const companyId = action === 'retryXrplPayment' ? actor.companyId : undefined;
      after(async () => { await runXrplJobs(decideXrplHandover, { attemptId, companyId }); });
    }
    const state = await marketplaceState(actor);
    if (result.data && typeof result.data === 'object' && 'paymentError' in result.data && 'paymentStatus' in result.data) {
      return json({ error: result.data.paymentError, state }, Number(result.data.paymentStatus));
    }
    return json({ data: result.data, state });
  } catch (error) {
    return apiError(error);
  }
}
