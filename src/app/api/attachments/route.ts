import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { actorOrder, audit, MarketplaceError } from "@/server/access";
import { actionLimit, getDb, mutate } from "@/server/db";
import { getActor } from "@/server/session";
import { readUploadForm, requireSameOrigin } from "@/server/http";
import { selectStorage, type StorageKind } from "@/integrations/storage";

export const runtime = "nodejs";
const maxSize = 8 * 1024 * 1024;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const validOrderId = z.string().regex(/^[a-z0-9-]{1,100}$/i);
const attachmentId = z.uuid();

type AttachmentRow = {
  id: string; order_id: string; name: string; mime_type: string; size: number; storage: StorageKind; created_at: Date | string;
};

function attachmentJson(row: AttachmentRow) {
  return {
    id: row.id, orderId: row.order_id, name: row.name, type: row.mime_type, size: row.size, createdAt: row.created_at,
    url: "/api/attachments?orderId=" + encodeURIComponent(row.order_id) + "&id=" + encodeURIComponent(row.id),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof MarketplaceError) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  if (error instanceof RangeError) return Response.json({ error: "Keep each file below 8 MB." }, { status: 413, headers: privateHeaders });
  return Response.json({ error: "The file operation could not finish. Try again." }, { status: 502, headers: privateHeaders });
}

function isSupported(type: string, bytes: Uint8Array) {
  const header = Buffer.from(bytes.slice(0, 12));
  if (type === "application/pdf") return header.toString("ascii", 0, 5) === "%PDF-";
  if (type === "image/png") return header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (type === "image/jpeg") return header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  if (type === "image/webp") return header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new MarketplaceError("Sign in to access order attachments.", 401);
    const query = new URL(request.url).searchParams;
    const orderId = validOrderId.safeParse(query.get("orderId"));
    if (!orderId.success) throw new MarketplaceError("Select a valid order.");
    const db = await getDb();
    await actorOrder(db, actor, orderId.data);
    const id = query.get("id");
    if (!id) {
      const rows = await sql<AttachmentRow>`select * from order_attachments where order_id = ${orderId.data}
        order by created_at desc limit 100`.execute(db);
      return Response.json({ attachments: rows.rows.map(attachmentJson) }, { headers: privateHeaders });
    }
    if (!attachmentId.safeParse(id).success) throw new MarketplaceError("Attachment was not found.", 404);
    const file = (await sql<AttachmentRow>`select * from order_attachments where id = ${id}
      and order_id = ${orderId.data}`.execute(db)).rows[0];
    if (!file) throw new MarketplaceError("Attachment was not found.", 404);
    const storage = selectStorage(Boolean(actor.demoRole), file.storage);
    if (!storage) throw new MarketplaceError("Private file storage is unavailable.", 503);
    const filename = encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
    return new Response(await storage.provider.open(id), {
      headers: {
        ...privateHeaders, "Content-Type": file.mime_type, "Content-Length": String(file.size),
        "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, true);
    const actor = await getActor();
    if (!actor) throw new MarketplaceError("Sign in to upload order attachments.", 401);
    if (actor.role === "reviewer") throw new MarketplaceError("Reviewers have read-only access to order attachments.", 403);
    if (!await actionLimit("attachment:" + actor.id, 10, 1)) throw new MarketplaceError("Wait before uploading again.", 429);
    const storage = selectStorage(Boolean(actor.demoRole));
    if (!storage) throw new MarketplaceError("Configure private file storage before uploading.", 503);

    const form = await readUploadForm(request, maxSize + 16_384);
    const orderId = validOrderId.safeParse(form?.get("orderId"));
    const file = form?.get("file");
    if (!orderId.success || !(file instanceof File) || !file.size) {
      throw new MarketplaceError("Choose an order and a PDF, JPEG, PNG or WebP file.");
    }
    if (file.size > maxSize) throw new RangeError("Upload too large");
    await actorOrder(await getDb(), actor, orderId.data);
    const bytes = await file.arrayBuffer();
    if (!isSupported(file.type, new Uint8Array(bytes))) throw new MarketplaceError("Choose a valid PDF, JPEG, PNG or WebP file.");
    const id = randomUUID();
    const name = file.name.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").slice(0, 140) || "attachment";
    await storage.provider.put(id, bytes, file.type);
    let attachment: AttachmentRow;
    try {
      attachment = await mutate(async (db) => {
        await actorOrder(db, actor, orderId.data);
        const result = await sql<AttachmentRow>`insert into order_attachments
          (id, order_id, uploader_id, name, mime_type, size, storage)
          values (${id}, ${orderId.data}, ${actor.id}, ${name}, ${file.type}, ${file.size}, ${storage.kind})
          returning *`.execute(db);
        await audit(db, actor, "upload_attachment", id);
        return result.rows[0];
      });
    } catch (error) {
      await storage.provider.remove(id).catch(() => {});
      throw error;
    }
    return Response.json({ attachment: attachmentJson(attachment) }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
