import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import sharp from 'sharp';
import { z } from 'zod';
import type { Listing } from '@/shared/marketplace';
import { audit, MarketplaceError, requireRole } from '@/server/access';
import { actionLimit, getDb, mutate, tables, update } from '@/server/db';
import { apiError, json, readRequestBody, requireSameOrigin } from '@/server/http';
import { id } from '@/server/inputs';
import { saveListing } from '@/server/procurement';
import { getActor } from '@/server/session';
import { marketplaceState } from '@/server/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxUpload = 8 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new MarketplaceError('Sign in to view listing photos.', 401);
    const params = new URL(request.url).searchParams;
    const listing = id.safeParse(params.get('listingId'));
    const version = z.uuid().safeParse(params.get('version'));
    if (!listing.success || !version.success) throw new MarketplaceError('Photo was not found.', 404);
    const photo = (await sql<{ contents: Buffer }>`select p.contents from listing_photos p
      join listings l on l.id = p.listing_id join companies c on c.id = l.company_id
      where p.listing_id = ${listing.data} and p.version = ${version.data}::uuid and c.demo = ${Boolean(actor.demoRole)}
        and (c.id = ${actor.companyId} or (l.data->>'archived' = 'false' and c.data->'verification'->>'business' = 'verified'))
    `.execute(await getDb())).rows[0];
    if (!photo) throw new MarketplaceError('Photo was not found.', 404);
    return new Response(new Uint8Array(photo.contents), { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(photo.contents.byteLength),
      'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, true);
    const actor = await getActor();
    if (!actor) throw new MarketplaceError('Sign in to upload a listing photo.', 401);
    requireRole(actor, 'owner', 'sales');
    if (!await actionLimit(`listing-photo:${actor.id}`, 12, 1)) throw new MarketplaceError('Wait before uploading again.', 429);
    const body = await readRequestBody(request, maxUpload + 16_384, 'Keep listing photos below 8 MB.');
    const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' } })
      .formData().catch(() => null);
    const file = form?.get('photo');
    const fields = form?.get('listing');
    if (typeof fields !== 'string' || !(file instanceof File) || !file.size) throw new MarketplaceError('Choose a listing photo.');
    if (file.size > maxUpload) throw new MarketplaceError('Keep listing photos below 8 MB.', 413);
    let input: unknown;
    try { input = JSON.parse(fields); }
    catch { throw new MarketplaceError('Enter valid listing details.'); }

    let contents: Buffer;
    try {
      const image = sharp(await file.arrayBuffer(), { limitInputPixels: 36_000_000, failOn: 'warning' });
      const { format, pages } = await image.metadata();
      if (!format || !['jpeg', 'png', 'webp'].includes(format) || (pages ?? 1) !== 1) throw new Error('Unsupported image');
      contents = await image.autoOrient().resize(900, 900, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 76 }).toBuffer();
    } catch { throw new MarketplaceError('Choose a valid JPEG, PNG or WebP photo up to 36 megapixels.', 422); }
    if (contents.length > 524_288) throw new MarketplaceError('Choose a smaller listing photo.', 422);

    const listing = await mutate(async (db) => {
      const saved = await saveListing(db, actor, { listing: input });
      const version = randomUUID();
      const updated: Listing = { ...saved, image: `/api/listing-photo?listingId=${encodeURIComponent(saved.id)}&version=${version}` };
      await sql`insert into listing_photos (listing_id, version, contents) values (${saved.id}, ${version}, ${contents})
        on conflict (listing_id) do update set version = excluded.version, contents = excluded.contents`.execute(db);
      await update(db, tables.listings, updated.id, updated);
      await audit(db, actor, 'set_listing_photo', updated.id);
      return updated;
    });
    return json({ data: listing, state: await marketplaceState(actor) });
  } catch (error) { return apiError(error); }
}
