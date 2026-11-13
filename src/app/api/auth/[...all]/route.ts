import { getAuth } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => Response.json({ error: 'Use the StockPact app to manage your account.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/auth\/reset-password\/[a-zA-Z0-9]{24}$/.test(path)) return notFound();
  const response = await (await getAuth()).handler(request);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
}

export const POST = notFound;
