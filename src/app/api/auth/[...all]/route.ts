import { getAuth } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/sign-up/email')) return Response.json({ error: 'Register from the StockPact app.' }, { status: 404 });
  return (await getAuth()).handler(request);
}

export const GET = handle;
export const POST = handle;
