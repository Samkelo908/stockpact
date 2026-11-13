import { after } from 'next/server';
import { decideXrplHandover } from '@/integrations/purchasing';
import { recoverJobs } from '@/server/actions';
import { apiError, json } from '@/server/http';
import { getActor } from '@/server/session';
import { marketplaceState } from '@/server/state';
import { runXrplJobs } from '@/server/xrpl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await getActor();
    await recoverJobs(actor);
    const state = await marketplaceState(actor);
    if (actor?.demoRole && actor.role === 'owner' && (state.xrpl?.configured || state.xrpl?.attempts.some((attempt) => attempt.status === 'pending'))) {
      after(async () => { await runXrplJobs(decideXrplHandover, { companyId: actor.companyId }); });
    }
    return json(state);
  } catch (error) {
    return apiError(error);
  }
}
