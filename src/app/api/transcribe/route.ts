import { getTranscriptionProvider } from "@/integrations/purchasing";
import { MarketplaceError } from "@/server/access";
import { actionLimit } from "@/server/db";
import { apiError, json, readUploadForm, requireSameOrigin } from "@/server/http";
import { getActor } from "@/server/session";

export const runtime = "nodejs";

const maxBytes = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, true);
    const actor = await getActor();
    if (!actor) return json({ error: "Sign in to use voice input." }, 401);
    const provider = getTranscriptionProvider();
    if (!provider) return json({ error: "Cloudflare transcription is unavailable. Use browser voice input or type your request." }, 503);
    if (!await actionLimit("transcribe:" + actor.id, 6, 1)) {
      return Response.json({ error: "Please wait before sending another recording." }, {
        status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" },
      });
    }
    const form = await readUploadForm(request, maxBytes + 16_384);
    const audio = form?.get("audio");
    if (!(audio instanceof File) || !/^(audio\/(webm|mp4|ogg|mpeg|wav|x-wav|aac))(?:;|$)/i.test(audio.type) || !audio.size) {
      return Response.json({ error: "Record or upload a supported audio clip." }, { status: 400 });
    }
    if (audio.size > maxBytes) throw new RangeError("Recording too large");
    const text = await provider.transcribe(await audio.arrayBuffer());
    if (!text) return Response.json({ error: "No speech was detected. Try recording again." }, { status: 422 });
    return json({ text, mode: "cloudflare" });
  } catch (error) {
    if (error instanceof MarketplaceError) return apiError(error);
    if (error instanceof RangeError) return Response.json({ error: "Keep your recording below 8 MB." }, { status: 413 });
    return Response.json({ error: "Transcription could not finish. Try again or type your request." }, { status: 502 });
  }
}
