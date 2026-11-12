import { recoverJobs } from '@/server/actions';
import { apiError, json } from '@/server/http';
import { getActor } from '@/server/session';
import { marketplaceState } from '@/server/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await getActor();
    await recoverJobs(actor);
    return json(await marketplaceState(actor));
  } catch (error) {
    return apiError(error);
  }
}
