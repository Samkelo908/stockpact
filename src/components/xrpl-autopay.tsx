"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, ExternalLink, Pause, Play, Plus, RotateCw, ShieldCheck, Wallet } from "lucide-react";
import type { MarketplaceState, Order } from "../shared/marketplace";
import type { XrplAttempt, XrplMandate } from "../shared/xrpl";
import { companyName, companyOf, type Navigate, type RunAction } from "./client";
import { Busy, Dialog, PanelTitle, Tag, dateLabel } from "./ui";

const dropsPerXrp = 1_000_000n;

function wholeDrops(value: string) {
  return /^\d{1,24}$/.test(value) ? BigInt(value) : 0n;
}

function fromDrops(value: bigint) {
  const integer = value / dropsPerXrp;
  const decimal = (value % dropsPerXrp).toString().padStart(6, "0").replace(/0+$/, "");
  return decimal ? `${integer}.${decimal}` : String(integer);
}

function toDrops(value: string) {
  if (!/^(?:\d{1,7}(?:[.,]\d{1,6})?|[.,]\d{1,6})$/.test(value)) return null;
  const [integer, decimal = ""] = value.split(/[.,]/);
  const drops = BigInt(integer || "0") * dropsPerXrp + BigInt(decimal.padEnd(6, "0"));
  return drops > 0n && drops <= 9_999_999_999_999n ? drops.toString() : null;
}

export function xrplAmount(cents: number, dropsPerCent: number | undefined) {
  if (!Number.isSafeInteger(cents) || cents < 0 || !Number.isSafeInteger(dropsPerCent) || !dropsPerCent || dropsPerCent < 0) return "Test XRP";
  return `${fromDrops(BigInt(cents) * BigInt(dropsPerCent))} test XRP`;
}

export function formatXrplDrops(drops: string | bigint) {
  return `${fromDrops(typeof drops === "string" ? wholeDrops(drops) : drops)} test XRP`;
}

function explorerLink(base: string | undefined, hash: string | undefined) {
  if (!base || !hash || !/^[0-9a-f]{64}$/i.test(hash)) return undefined;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return new URL(`transactions/${hash}`, `${url.href.replace(/\/$/, "")}/`).href;
  } catch { return undefined; }
}

function MandateEditor({ state, mandate, busy, run, onClose }: { state: MarketplaceState; mandate?: XrplMandate; busy: string; run: RunAction; onClose: () => void }) {
  const [problem, setProblem] = useState("");
  const config = state.xrpl;
  const supplierOptions = state.companies.filter((company) => company.id === config?.supplierId && company.id !== state.actor?.companyId &&
    company.capabilities.includes("supplier") && company.verification.business === "verified" &&
    !(config?.mandates ?? []).some((item) => item.supplierId === company.id));
  const recipient = mandate?.recipient ?? config?.recipient ?? "";
  const destinationTag = mandate?.destinationTag ?? config?.destinationTag;
  const max = mandate ? fromDrops(wholeDrops(mandate.maxDrops)) : "";
  const total = mandate ? fromDrops(wholeDrops(mandate.totalDrops)) : "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem("");
    const fields = new FormData(event.currentTarget);
    const maxDrops = toDrops(String(fields.get("max") ?? "").trim());
    const totalDrops = toDrops(String(fields.get("total") ?? "").trim());
    const tag = String(fields.get("tag") ?? "").trim();
    if (!maxDrops || !totalDrops) { setProblem("Enter positive XRP limits with up to six decimal places."); return; }
    if (BigInt(maxDrops) > BigInt(totalDrops)) { setProblem("The per-payment limit must be at or below the total limit."); return; }
    if (tag && (!/^\d{1,10}$/.test(tag) || Number(tag) > 4_294_967_295)) { setProblem("Enter a destination tag between 0 and 4294967295."); return; }
    if (await run("saveXrplMandate", {
      supplierId: mandate?.supplierId ?? fields.get("supplierId"),
      recipient: String(fields.get("recipient") ?? "").trim(),
      destinationTag: tag ? Number(tag) : undefined,
      maxDrops,
      totalDrops,
    }, "XRPL Testnet mandate saved.")) onClose();
  }

  return <Dialog title={mandate ? "Edit test autopay mandate" : "Approve a test autopay mandate"} onClose={onClose}>
    <form className="stack" onSubmit={(event) => void save(event)}>
      <p className="notice"><ShieldCheck size={17} />A verified handover can trigger a transfer to the approved Testnet address, within the limits you set. Test XRP has no monetary value.</p>
      {problem && <p className="notice notice-error" role="alert"><CircleAlert size={16} />{problem}</p>}
      {mandate ? <p className="small-note">Supplier <strong>{companyName(state, mandate.supplierId)}</strong></p> : <label className="field">Approved supplier<select name="supplierId" defaultValue="" required><option value="" disabled>Select a verified supplier</option>{supplierOptions.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}
      <label className="field">Supplier XRPL Testnet address<input name="recipient" value={recipient} autoCapitalize="none" spellCheck={false} readOnly /><small>Destination configured for this supplier by the workspace.</small></label>
      {destinationTag != null && <label className="field">Destination tag<input name="tag" inputMode="numeric" value={destinationTag} readOnly /></label>}
      <div className="form-grid">
        <label className="field">Per-payment limit (XRP)<input name="max" inputMode="decimal" defaultValue={max} placeholder="1" maxLength={16} required /></label>
        <label className="field">Total limit (XRP)<input name="total" inputMode="decimal" defaultValue={total} placeholder="5" maxLength={16} required /></label>
      </div>
      {config?.maxPaymentDrops && <p className="small-note">This workspace caps any transfer at {fromDrops(wholeDrops(String(config.maxPaymentDrops)))} test XRP.</p>}
      <label className="check"><input type="checkbox" required />I authorise Testnet autopay for this supplier within these limits.</label>
      <div><button className="primary" type="submit" disabled={!!busy}><ShieldCheck size={16} />{mandate ? "Save mandate" : "Approve mandate"}</button></div>
    </form>
  </Dialog>;
}

export function XrplMandates({ state, busy, run }: { state: MarketplaceState; busy: string; run: RunAction }) {
  const [edit, setEdit] = useState<XrplMandate | "new" | null>(null);
  const config = state.xrpl;
  const company = companyOf(state, state.actor?.companyId);
  if (!config || !state.actor || !company?.capabilities.includes("buyer") || (!config.enabled && !config.mandates.length)) return null;
  const owner = state.actor.role === "owner";
  const mandates = config.mandates;
  const canAdd = state.companies.some((item) => item.id === config.supplierId && item.id !== company.id && item.verification.business === "verified" && item.capabilities.includes("supplier") && !mandates.some((entry) => entry.supplierId === item.id));
  return <section id="xrpl-autopay" className="card panel stack xrpl-panel">
    <PanelTitle title="XRPL Testnet autopay" subtitle="Approve a supplier, payout address and XRP limits before enabling autopay on an order." action={<Tag value={config.configured ? "Testnet" : "Unavailable"} variant={config.configured ? "blue" : "grey"} />} />
    <p className="small-note">Test XRP has no monetary value. The workspace uses a fixed demo amount of {xrplAmount(100_000, config.dropsPerZarCent)} per R1,000 of quoted value.</p>
    {!config.configured && <p className="notice notice-warn"><Wallet size={16} />This workspace’s XRP Ledger Testnet signer is unavailable.</p>}
    {config.configured && !mandates.length && <p className="small-note">No supplier mandates have been approved.</p>}
    {mandates.map((mandate) => {
      const remaining = wholeDrops(mandate.totalDrops) - wholeDrops(mandate.usedDrops) - wholeDrops(mandate.reservedDrops);
      return <article key={mandate.id} className="subcard small-stack">
        <div className="split-line"><div><h3>{companyName(state, mandate.supplierId)}</h3><p className="xrpl-address">{mandate.recipient}{mandate.destinationTag != null && ` · Tag ${mandate.destinationTag}`}</p></div><Tag value={mandate.paused ? "Paused" : "Active"} variant={mandate.paused ? "amber" : "green"} /></div>
        <dl className="details-grid"><div><dt>Per payment</dt><dd>{fromDrops(wholeDrops(mandate.maxDrops))} XRP</dd></div><div><dt>Available of {fromDrops(wholeDrops(mandate.totalDrops))} XRP total</dt><dd>{fromDrops(remaining > 0n ? remaining : 0n)} XRP</dd></div></dl>
        {owner && <div className="button-row"><button type="button" className="secondary" disabled={!!busy || !config.configured} onClick={() => setEdit(mandate)}>Edit mandate</button><button type="button" className="secondary" disabled={!!busy || (mandate.paused && !config.configured)} onClick={() => void run("pauseXrplMandate", { mandateId: mandate.id, paused: !mandate.paused }, mandate.paused ? "Test autopay mandate resumed." : "Test autopay mandate paused.")}>{mandate.paused ? <Play size={15} /> : <Pause size={15} />}{mandate.paused ? "Resume" : "Pause"}</button></div>}
      </article>;
    })}
    {owner && config.configured && (canAdd ? <div><button type="button" className="primary" disabled={!!busy} onClick={() => setEdit("new")}><Plus size={16} />New supplier mandate</button></div> : !mandates.length && <p className="small-note">A verified supplier must be available before you can approve a mandate.</p>)}
    {edit && <MandateEditor state={state} mandate={edit === "new" ? undefined : edit} busy={busy} run={run} onClose={() => setEdit(null)} />}
  </section>;
}

export const attemptStatuses: Record<XrplAttempt["status"], { label: string; tint: "green" | "amber" | "blue" | "red" }> = {
  queued: { label: "Queued for decision", tint: "blue" },
  processing: { label: "Checking payment", tint: "blue" },
  pending: { label: "Awaiting ledger validation", tint: "amber" },
  confirmed: { label: "Validated payment", tint: "green" },
  failed: { label: "Payment failed", tint: "red" },
  expired: { label: "Transaction expired", tint: "red" },
  blocked: { label: "Payment denied", tint: "red" },
};

export function xrplOrderPayment(state: MarketplaceState, order: Order) {
  if (order.paymentMode !== "xrpl" || !state.actor || ["driver", "reviewer"].includes(state.actor.role)) return undefined;
  const attempts = (state.xrpl?.attempts ?? []).filter((attempt) => attempt.orderId === order.id);
  const confirmed = attempts.filter(({ status }) => status === "confirmed").reduce((total, attempt) => total + wholeDrops(attempt.drops), 0n);
  const blocked = attempts.some(({ status }) => ["blocked", "failed", "expired"].includes(status));
  const processing = attempts.some(({ status }) => ["queued", "processing", "pending"].includes(status));
  const dropsPerCent = state.xrpl?.dropsPerZarCent;
  const deliveredValue = Number.isSafeInteger(dropsPerCent) && dropsPerCent && order.quantity > 0
    ? (BigInt(order.totalCents) * BigInt(order.acceptedQuantity) / BigInt(order.quantity)) * BigInt(dropsPerCent)
    : undefined;
  const unpaid = deliveredValue === undefined ? undefined : confirmed >= deliveredValue ? 0n : deliveredValue - confirmed;
  const unconfirmed = unpaid === undefined || unpaid > 0n;
  const label = !order.acceptedQuantity ? "Awaiting handover" : blocked ? "Payment action needed"
    : processing ? "Payment pending" : unconfirmed ? "Payment unconfirmed" : "Accepted handovers paid";
  const variant = !order.acceptedQuantity ? "grey" : blocked ? "red" : processing || unconfirmed ? "amber" : "green";
  return { attempts, confirmed, unpaid, label, variant } as const;
}

function Attempt({ attempt, state, run, busy, isBuyerOwner, navigate, showOrder }: { attempt: XrplAttempt; state: MarketplaceState; run: RunAction; busy: string; isBuyerOwner: boolean; navigate?: Navigate; showOrder: boolean }) {
  const status = attemptStatuses[attempt.status];
  const order = state.orders.find((item) => item.id === attempt.orderId);
  const link = attempt.status === "confirmed" && attempt.ledgerIndex != null ? explorerLink(state.xrpl?.explorerUrl ?? "https://testnet.xrpl.org", attempt.hash) : undefined;
  const checkStatus = isBuyerOwner && ["queued", "processing", "pending"].includes(attempt.status);
  const unsignedBlocked = attempt.status === "blocked" && !attempt.hash;
  const requeue = unsignedBlocked && isBuyerOwner && state.xrpl?.configured;
  const canReviewMandate = unsignedBlocked && isBuyerOwner && navigate;
  const canOpenOrder = showOrder && navigate;
  return <article className="subcard small-stack xrpl-attempt">
    <div className="split-line"><div><h3>{formatXrplDrops(attempt.drops)}</h3><p>{order?.reference && `${order.reference} · `}{dateLabel(attempt.updatedAt)}</p></div><Tag value={status.label} variant={status.tint} /></div>
    {attempt.reason && <p>{attempt.reason}</p>}
    {attempt.status === "processing" && <Busy label="Checking mandate and handover" />}
    {attempt.status === "pending" && <p className="small-note">StockPact is checking the original transaction. Keep this handover record and check again after validation.</p>}
    {unsignedBlocked && <p className="small-note">{isBuyerOwner ? "Review the reason and supplier mandate, then request another decision for this handover." : "Ask the buyer to review the supplier mandate and request another payment decision."}</p>}
    {attempt.hash && ["failed", "expired", "blocked"].includes(attempt.status) && <p className="small-note">{isBuyerOwner ? "Keep this transaction reference and contact your workspace operator to review the result." : "Share this transaction reference with the buyer for review."}</p>}
    {attempt.status === "confirmed" && <dl className="details-grid"><div><dt>Validated ledger</dt><dd>{attempt.ledgerIndex ?? "—"}</dd></div><div><dt>Destination</dt><dd className="xrpl-address">{attempt.recipient || "—"}</dd></div></dl>}
    {attempt.hash && <p className="xrpl-address" aria-label="XRPL transaction hash">{attempt.hash}</p>}
    {(link || checkStatus || requeue || canReviewMandate || canOpenOrder) && <div className="button-row">
      {link && <a className="secondary" href={link} target="_blank" rel="noreferrer">View Testnet receipt <ExternalLink size={15} /></a>}
      {checkStatus && <button type="button" className="secondary" disabled={!!busy} onClick={() => void run("retryXrplPayment", { attemptId: attempt.id })}><RotateCw size={15} />Check payment status</button>}
      {requeue && <button type="button" className="primary" disabled={!!busy} onClick={() => void run("requeueXrplPayment", { attemptId: attempt.id }, "Payment decision requested for the original handover.")}><RotateCw size={15} />Request payment again</button>}
      {canReviewMandate && <button type="button" className="secondary" onClick={() => navigate("settings", "xrpl")}>Review mandate <ArrowRight size={15} /></button>}
      {canOpenOrder && <button type="button" className="secondary" onClick={() => navigate("orders", attempt.orderId)}>Open order <ArrowRight size={15} /></button>}
    </div>}
  </article>;
}

export function XrplActivity({ state, order, navigate, busy, run }: { state: MarketplaceState; order?: Order; navigate?: Navigate; busy: string; run: RunAction }) {
  if (order && !xrplOrderPayment(state, order)) return null;
  const config = state.xrpl;
  const attempts = (config?.attempts ?? []).filter((item) => !order || item.orderId === order.id).toSorted((first, second) => second.createdAt.localeCompare(first.createdAt));
  if (!order && !attempts.length) return null;
  return <section className="card panel stack xrpl-panel"><PanelTitle title="XRPL Testnet activity" subtitle="Accepted deliveries and validated payments are recorded separately." />
    {!attempts.length && <p className="small-note">Autopay is checked after the supplier or assigned driver accepts the handover QR.</p>}
    {attempts.slice(0, order ? 15 : 5).map((attempt) => <Attempt key={attempt.id} attempt={attempt} state={state} busy={busy} run={run} isBuyerOwner={state.actor?.role === "owner" && (order ?? state.orders.find((item) => item.id === attempt.orderId))?.buyerId === state.actor.companyId} navigate={navigate} showOrder={!order} />)}
  </section>;
}

export function XrplCheckout({ state, order, busy, run, navigate, onDone }: { state: MarketplaceState; order: Order; busy: string; run: RunAction; navigate: Navigate; onDone: () => void }) {
  const config = state.xrpl;
  const canEnable = isXrplAvailable(state, order);
  if (!canEnable || !config) return null;
  const mandate = config.mandates.find((item) => item.supplierId === order.supplierId);
  return <section className="subcard small-stack xrpl-checkout" aria-label="XRPL Testnet autopay">
    <div className="split-line"><div><h3>XRPL Testnet autopay</h3><p>{xrplAmount(order.totalCents, config.dropsPerZarCent)} for full delivery</p></div><Tag value="Testnet" variant="blue" /></div>
    <p>After a verified handover, StockPact checks the supplier mandate and can send valueless test XRP. No escrow deposit is taken.</p>
    {mandate && !mandate.paused ? <div><button type="button" className="primary" disabled={!!busy} onClick={async () => { if (await run("enableXrplOrder", { orderId: order.id }, "XRPL Testnet autopay enabled. Order ready for dispatch.")) onDone(); }}><Wallet size={16} />Enable test autopay</button></div> : <div><button type="button" className="secondary" onClick={() => { onDone(); navigate("settings", "xrpl"); }}>{mandate ? "Review paused mandate" : "Set up a supplier mandate"}<ArrowRight size={16} /></button></div>}
  </section>;
}

export function orderStateLabel(order: Pick<Order, "paymentMode" | "status">) {
  if (order.paymentMode !== "xrpl") return order.status;
  if (order.status === "funded") return "Ready for dispatch";
  if (order.status === "partial") return "Partial delivery";
  return order.status === "completed" ? "Delivery complete" : order.status;
}

export function isXrplAvailable(state: MarketplaceState, order: Order) {
  return !!state.xrpl?.configured && state.xrpl.supplierId === order.supplierId && state.actor?.role === "owner" && state.actor.companyId === order.buyerId &&
    (order.currency ?? "ZAR") === "ZAR" && order.status === "awaiting_funding" && !order.transactions.length;
}
