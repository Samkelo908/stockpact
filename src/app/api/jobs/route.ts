import { timingSafeEqual } from 'node:crypto';
import { apiError, json } from '@/server/http';
import { runMarketplaceMaintenance } from '@/server/maintenance';
import { runMatchingJobs } from '@/server/procurement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.STOCKPACT_JOBS_SECRET;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json({ error: 'Job access is unavailable.' }, 403);
  try {
    const processed = await runMatchingJobs();
    return json({ processed, ...await runMarketplaceMaintenance() });
  }
  catch (error) { return apiError(error); }
}
