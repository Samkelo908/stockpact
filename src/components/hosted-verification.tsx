"use client";

import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import type { Company, MarketplaceState, VerificationScope } from "../shared/marketplace";
import { titleCase } from "./ui";

export function HostedVerification({ provider, company }: {
  provider: NonNullable<MarketplaceState["verificationProvider"]>;
  company: Company;
}) {
  const [status, setStatus] = useState<{ scope: VerificationScope; url?: string; error?: string } | null>(null);
  const scopes = provider.scopes.filter((scope) => scope !== "delivery" || company.capabilities.includes("delivery"));
  if (!scopes.length) return null;

  async function start(scope: VerificationScope) {
    setStatus({ scope });
    try {
      const response = await fetch("/api/verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Verification could not start. Try again.");
      setStatus({ scope, url: result.url });
    } catch (error) {
      setStatus({ scope, error: error instanceof Error ? error.message : "Verification could not start." });
    }
  }

  const busy = !!status && !status.url && !status.error;
  return <div className="small-stack">
    {provider.sandbox && <p className="small-note">Persona sandbox checks leave company permissions unchanged.</p>}
    <div className="button-row">{scopes.map((scope) => <button type="button" className="secondary" key={scope}
      disabled={busy || (!provider.sandbox && company.verification[scope] === "verified")}
      onClick={() => void start(scope)}><ShieldCheck size={16} />{busy && status.scope === scope ? "Opening…" : "Verify " + titleCase(scope).toLowerCase()}</button>)}</div>
    {status?.error && <p className="notice notice-error" role="alert">{status.error}</p>}
    {status?.url && <a className="primary" href={status.url} target="_blank" rel="noopener noreferrer">Continue to Persona <ArrowUpRight size={16} /></a>}
  </div>;
}
