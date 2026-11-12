import { sql } from "kysely";
import { parsePersonaEvent, verifyPersonaSignature, type VerificationScope } from "@/integrations/verification";
import type { Company } from "@/shared/marketplace";
import { notify } from "@/server/access";
import { mutate, record, tables, update } from "@/server/db";
import { apiError, json, readRequestBody } from "@/server/http";
import { recordVerification } from "@/server/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STOCKPACT_PERSONA_WEBHOOK_SECRET;
  const signature = request.headers.get("persona-signature");
  if (!secret || !signature) return json({ error: "Webhook authentication failed." }, 401);
  try {
    const raw = new Uint8Array(await (await readRequestBody(request, 512_000)).arrayBuffer());
    if (!verifyPersonaSignature(raw, signature, secret)) return json({ error: "Webhook authentication failed." }, 401);
    const event = parsePersonaEvent(raw);
    if (!event) return json({ received: true });
    await mutate(async (db) => {
      const changed = (await sql<{ company_id: string; scope: VerificationScope; sandbox: boolean }>`
        update persona_inquiries set status = ${event.status}, event_at = ${event.at}, event_id = ${event.id}
        where inquiry_id = ${event.inquiry} and (event_at is null or event_at < ${event.at})
        returning company_id, scope, sandbox`.execute(db)).rows[0];
      if (!changed) return;
      const company = await record<Company>(db, tables.companies, changed.company_id);
      if (!company) return;
      await recordVerification(db, { companyId: company.id, scope: changed.scope, status: event.status,
        provider: changed.sandbox ? "persona-sandbox" : "persona", providerReference: event.inquiry,
        note: !changed.sandbox && event.status === "verified" ? "Persona approved the inquiry. A platform reviewer must match it to the company record." : undefined });
      if (!changed.sandbox && !company.demo && company.verification[changed.scope] === "pending") {
        company.verification[changed.scope] = event.status === "verified" ? "pending" : event.status;
        await update(db, tables.companies, company.id, company);
        await notify(db, company.id, "Verification status updated", "Check the latest status in company settings.", "#settings");
      }
    });
    return json({ received: true });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Webhook body was not valid JSON." }, 400);
    return apiError(error);
  }
}
