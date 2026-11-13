import { timingSafeEqual } from 'node:crypto';
import { decideXrplHandover } from '@/integrations/purchasing';
import { apiError, json } from '@/server/http';
import { runMarketplaceMaintenance } from '@/server/maintenance';
import { runMatchingJobs } from '@/server/procurement';
import { runXrplJobs } from '@/server/xrpl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.STOCKPACT_JOBS_SECRET;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json({ error: 'Job access is unavailable.' }, 403);
  try {
    const [processed, xrpl, maintenance] = await Promise.all([
      runMatchingJobs(), runXrplJobs(decideXrplHandover), runMarketplaceMaintenance(),
    ]);
    return json({ processed, xrplProcessed: xrpl.processed, ...maintenance });
  }
  catch (error) { return apiError(error); }
}
