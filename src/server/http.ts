import { APIError } from 'better-auth/api';
import { EscrowVerificationError } from '../integrations/escrow/server';
import { MarketplaceError } from './access';

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } });

export function apiError(error: unknown) {
  if (error instanceof MarketplaceError || error instanceof EscrowVerificationError) return json({ error: error.message }, error.status);
  if (error instanceof APIError) return json({ error: error.message }, error.statusCode);
  console.error('StockPact request failed.', error instanceof Error ? error.name : 'UnknownError');
  return json({ error: 'StockPact could not finish this operation. Please retry.' }, 500);
}

export function requireSameOrigin(request: Request, requireOrigin = false) {
  const origin = request.headers.get('origin');
  const candidates = [new URL(request.url).origin];
  if (process.env.BETTER_AUTH_URL) candidates.push(new URL(process.env.BETTER_AUTH_URL).origin);
  if ((!origin && requireOrigin) || (origin && !candidates.includes(origin)) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new MarketplaceError('This action must come from StockPact.', 403);
  }
}

export async function readRequestBody(request: Request, limit: number, message = 'This request is too large.') {
  const oversized = () => new MarketplaceError(message, 413);
  if (Number(request.headers.get('content-length')) > limit) throw oversized();
  const reader = request.body?.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  if (!reader) return new Blob();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw oversized();
      }
      chunks.push(new Uint8Array(value).buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}

export async function readUploadForm(request: Request, limit: number) {
  return new Response(await readRequestBody(request, limit, 'Keep uploads below 8 MB.'), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  })
    .formData().catch(() => null);
}
