import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { VerificationScope, VerificationStatus } from "@/shared/marketplace";

export const verificationScope = z.enum(["business", "representative", "delivery"]);
export type { VerificationScope } from "@/shared/marketplace";

export interface VerificationProvider {
  sandbox: boolean;
  scopes: VerificationScope[];
  createInquiry(scope: VerificationScope, attempt: string): Promise<string>;
  oneTimeLink(inquiry: string): Promise<string>;
}

const inquiryResponse = z.object({ data: z.object({ id: z.string().regex(/^inq_[a-z0-9]+$/i) }) });
const linkResponse = z.object({ meta: z.object({ "one-time-link": z.url() }) });

export function verificationProvider(): VerificationProvider | null {
  const key = process.env.STOCKPACT_PERSONA_API_KEY;
  if (!key || !/^persona_(sandbox|production)_/.test(key) || !process.env.STOCKPACT_PERSONA_WEBHOOK_SECRET) return null;
  const templates = {
    business: process.env.STOCKPACT_PERSONA_BUSINESS_TEMPLATE,
    representative: process.env.STOCKPACT_PERSONA_REPRESENTATIVE_TEMPLATE,
    delivery: process.env.STOCKPACT_PERSONA_DELIVERY_TEMPLATE,
  };
  const scopes = verificationScope.options.filter((scope) => /^itmpl_[a-z0-9]+$/i.test(templates[scope] ?? ""));
  if (!scopes.length) return null;

  async function post(path: string, payload?: object, idempotencyKey?: string) {
    const response = await fetch("https://api.withpersona.com/api/v1/inquiries" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Persona-Version": "2026-09-29",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Verification provider could not complete this request.");
    return response.json();
  }

  return {
    sandbox: key.startsWith("persona_sandbox_"),
    scopes,
    async createInquiry(scope, attempt) {
      const response = await post("", {
        data: { attributes: { "inquiry-template-id": templates[scope], "reference-id": attempt } },
      }, attempt);
      return inquiryResponse.parse(response).data.id;
    },
    async oneTimeLink(inquiry) {
      const response = await post("/" + encodeURIComponent(inquiry) + "/generate-one-time-link");
      const link = new URL(linkResponse.parse(response).meta["one-time-link"]);
      if (link.protocol !== "https:" || (link.hostname !== "withpersona.com" && !link.hostname.endsWith(".withpersona.com"))) {
        throw new Error("Verification provider returned an invalid link.");
      }
      return link.href;
    },
  };
}

const events: Record<string, Exclude<VerificationStatus, "unsubmitted">> = {
  "inquiry.started": "pending",
  "inquiry.completed": "pending",
  "inquiry.marked-for-review": "pending",
  "inquiry.approved": "verified",
  "inquiry.failed": "action_required",
  "inquiry.expired": "expired",
  "inquiry.declined": "rejected",
  "inquiry.redacted": "expired",
};

const webhookBody = z.object({
  data: z.object({
    id: z.string().regex(/^evt_[a-z0-9]+$/i),
    attributes: z.object({
      name: z.string(),
      "created-at": z.iso.datetime({ offset: true }),
      payload: inquiryResponse,
    }),
  }),
});

export function verifyPersonaSignature(body: Uint8Array, header: string, secret: string, now = Date.now()) {
  return header.trim().split(/\s+/).some((set) => {
    const signature = /^t=(\d{10}),v1=([a-f0-9]{64})$/i.exec(set);
    if (!signature || Math.abs(now - Number(signature[1]) * 1000) > 300000) return false;
    const expected = createHmac("sha256", secret).update(signature[1] + ".").update(body).digest();
    return timingSafeEqual(expected, Buffer.from(signature[2], "hex"));
  });
}

export function parsePersonaEvent(body: Uint8Array) {
  const event = webhookBody.safeParse(JSON.parse(Buffer.from(body).toString("utf8")));
  if (!event.success) return null;
  const { id, attributes } = event.data.data;
  const status = Object.hasOwn(events, attributes.name) ? events[attributes.name] : undefined;
  return status ? { id, status, inquiry: attributes.payload.data.id, at: new Date(attributes["created-at"]) } : null;
}
