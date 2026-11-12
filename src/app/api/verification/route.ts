import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { verificationProvider, verificationScope } from "@/integrations/verification";
import { actorCompany, MarketplaceError, requireRole } from "@/server/access";
import { actionLimit, mutate, tables, update } from "@/server/db";
import { apiError, json, readRequestBody, requireSameOrigin } from "@/server/http";
import { getActor } from "@/server/session";
import { recordVerification } from "@/server/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, true);
    const actor = await getActor();
    if (!actor) throw new MarketplaceError("Sign in to start verification.", 401);
    requireRole(actor, "owner");
    const provider = verificationProvider();
    if (!provider || (actor.demoRole && !provider.sandbox)) {
      throw new MarketplaceError("Hosted verification is unavailable for this workspace.", 503);
    }
    const body = await (await readRequestBody(request, 4096)).text();
    const parsed = z.object({ scope: verificationScope }).safeParse(JSON.parse(body));
    if (!parsed.success || !provider.scopes.includes(parsed.data.scope)) throw new MarketplaceError("Choose an available verification.");
    if (!await actionLimit("persona:" + actor.companyId, 8, 10)) throw new MarketplaceError("Wait before starting another check.", 429);
    const { scope } = parsed.data;
    const attempt = await mutate(async (db) => {
      const company = await actorCompany(actor, db);
      if (!provider.sandbox && company.verification[scope] === "verified") throw new MarketplaceError("This verification is already approved.", 409);
      if (scope === "delivery" && !company.capabilities.includes("delivery")) throw new MarketplaceError("Enable delivery services first.", 422);
      if (!provider.sandbox && (!company.registrationNumber || !company.location || !company.representative)) {
        throw new MarketplaceError("Complete company registration, address and representative details first.", 422);
      }
      const prior = (await sql<{ attempt_id: string; inquiry_id: string | null; status: string; sandbox: boolean }>`
        select * from persona_inquiries where company_id = ${company.id} and scope = ${scope}`.execute(db)).rows[0];
      if (prior?.status === "pending" && prior.sandbox === provider.sandbox) return prior;
      const attemptId = randomUUID();
      await sql`insert into persona_inquiries (company_id, scope, attempt_id, sandbox, status)
        values (${company.id}, ${scope}, ${attemptId}, ${provider.sandbox}, 'pending')
        on conflict (company_id, scope) do update set attempt_id = excluded.attempt_id,
          sandbox = excluded.sandbox, status = 'pending', inquiry_id = null, event_at = null, event_id = null`.execute(db);
      return { attempt_id: attemptId, inquiry_id: null };
    });

    let inquiry: string;
    let url: string;
    try {
      inquiry = attempt.inquiry_id ?? await provider.createInquiry(scope, attempt.attempt_id);
      url = await provider.oneTimeLink(inquiry);
    } catch {
      throw new MarketplaceError("The verification provider could not open a session. Try again later.", 502);
    }
    await mutate(async (db) => {
      const saved = await sql`update persona_inquiries set inquiry_id = ${inquiry}
        where attempt_id = ${attempt.attempt_id} and inquiry_id is null returning attempt_id`.execute(db);
      if (!saved.rows.length) {
        const current = await sql`select inquiry_id from persona_inquiries where attempt_id = ${attempt.attempt_id}
          and inquiry_id = ${inquiry}`.execute(db);
        if (!current.rows.length) throw new MarketplaceError("Company details changed. Start a new verification.", 409);
        return;
      }
      const company = await actorCompany(actor, db);
      await recordVerification(db, { companyId: company.id, scope, status: "pending", actorId: actor.id,
        provider: provider.sandbox ? "persona-sandbox" : "persona", providerReference: inquiry });
      if (!provider.sandbox) {
        company.verification[scope] = "pending";
        await update(db, tables.companies, company.id, company);
      }
    });
    return json({ url, sandbox: provider.sandbox });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Send a valid verification request." }, 400);
    return apiError(error);
  }
}
