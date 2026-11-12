"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, AudioLines, Banknote, ClipboardList, FileCheck2, FileText, MapPin, PackageCheck, ScanLine, Search, ShieldCheck, Store, Truck } from "lucide-react";
import type { MarketplaceState, PurchaseRequest, RequestDraft } from "../shared/marketplace";
import { cents, companyOf, type Navigate, type RunAction } from "./client";
import { Empty, PanelTitle, Tag, TextButton, ViewTitle, dateLabel, number } from "./ui";
import { Voice } from "./voice";

export function freshDraft(location = "Cape Town"): RequestDraft {
  return { product: "", quantity: 1, unit: "units", location, requiredDate: "", budgetCents: null, notes: "", category: "", substitutions: false, collection: false, shareBudget: false, mode: "manual" };
}

type ComposerProps = {
  state: MarketplaceState;
  prompt: string;
  setPrompt: (value: string) => void;
  draft: RequestDraft | null;
  setDraft: (draft: RequestDraft | null) => void;
  busy: string;
  generate: () => Promise<void>;
  navigate: Navigate;
};

export function Dashboard({ state, prompt, setPrompt, busy, generate, setDraft, navigate }: ComposerProps) {
  const company = companyOf(state, state.actor?.companyId);
  const role = state.actor?.role;
  const canBuy = company?.capabilities.includes("buyer") && (role === "owner" || role === "purchaser");
  const requests = state.requests.filter((request) => !["accepted", "expired"].includes(request.status));
  const quotes = state.quotes.filter((quote) => quote.status === "submitted" && state.requests.some((request) => request.id === quote.requestId && request.buyerId === state.actor?.companyId));
  const openOrders = state.orders.filter((order) => !["completed", "cancelled"].includes(order.status));
  const deliveries = openOrders.filter((order) => ["dispatched", "partial"].includes(order.status));
  const metrics = [
    { label: "Open requests", value: requests.length, icon: ClipboardList, view: "requests" },
    { label: "Quotes received", value: quotes.length, icon: FileCheck2, view: "requests" },
    { label: "Active orders", value: openOrders.length, icon: PackageCheck, view: "orders" },
    { label: "Deliveries in progress", value: deliveries.length, icon: Truck, view: "deliveries" },
  ] as const;
  const activity = [
    ...state.orders.map((order) => ({ key: order.id, title: order.product, detail: `${order.reference} · ${dateLabel(order.createdAt)}`, status: order.status, date: order.timeline.at(-1)?.at ?? order.createdAt, view: "orders" as const, icon: PackageCheck })),
    ...state.requests.map((request) => ({ key: request.id, title: request.draft.product, detail: `${number(request.draft.quantity)} ${request.draft.unit} · ${dateLabel(request.createdAt)}`, status: request.status, date: request.activity.at(-1)?.at ?? request.createdAt, view: "requests" as const, icon: FileText })),
  ].sort((first, second) => second.date.localeCompare(first.date)).slice(0, 4);
  const pendingApproval = state.orders.filter((order) => order.status === "approval").length;
  const readyToFund = state.orders.filter((order) => order.buyerId === company?.id && order.status === "awaiting_funding").length;
  const disputes = state.disputes.filter((dispute) => dispute.status === "open").length;
  const lowStock = state.listings.filter((listing) => listing.supplierId === state.actor?.companyId && !listing.archived && listing.available <= listing.minimum).length;
  const quickActions = [
    ...(role === "reviewer" ? [{ title: "Platform administration", detail: "Review verification checks and disputes", tint: "blue", icon: ShieldCheck, action: () => navigate("admin") }] : []),
    ...(!["reviewer", "driver"].includes(role ?? "") ? [
      { title: "Payments", detail: readyToFund ? readyToFund + (readyToFund === 1 ? " order ready to fund" : " orders ready to fund") : "View order funds and receipts", tint: "mint", icon: Banknote, action: () => navigate("funds") },
      { title: "Browse marketplace", detail: "Find stock from South African suppliers", tint: "amber", icon: Store, action: () => navigate("marketplace") },
    ] : []),
    ...(role === "driver" || role === "sales" || company?.capabilities.includes("supplier") ? [{ title: "Scan delivery QR", detail: "Review a handover and its payment", tint: "blue", icon: ScanLine, action: () => navigate("deliveries", "scan") }] : [{ title: "Track deliveries", detail: "See when goods are ready to inspect", tint: "blue", icon: Truck, action: () => navigate(role === "reviewer" ? "orders" : "deliveries") }]),
    { title: "Company verification", detail: "Review your business and delivery status", tint: "violet", icon: ShieldCheck, action: () => navigate("settings") },
  ];

  return <div className="dashboard-home">
    <ViewTitle title="Procurement overview" subtitle={company ? `Manage sourcing and orders for ${company.name}.` : "Manage sourcing, quotes and orders."} action={<span className="home-location"><MapPin size={15} aria-hidden="true" />{company?.location || "South Africa"}</span>} />
    {canBuy && <section className="sourcing-hero" aria-labelledby="purchase-heading">
      <div className="sourcing-hero-copy">
        <h2 id="purchase-heading">What does your business need?</h2>
        <p>Tell us what stock you need. Review your request before sending it to suppliers.</p>
        <form className="sourcing-form" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label className="sr-only" htmlFor="home-request">Describe your requirement</label>
          <input id="home-request" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} placeholder="e.g. 20 cases of water" maxLength={2000} required />
          <Voice onTranscript={setPrompt} disabled={!!busy} preferCloudflare={state.aiMode === "cloudflare"} />
          <button className="primary" type="submit" disabled={!!busy} aria-label="Build request"><span>Build request</span><ArrowRight size={16} /></button>
        </form>
        <div className="sourcing-helpers">
          <button type="button" onClick={() => { setDraft(freshDraft(company?.location)); navigate("assistant"); }}><ClipboardList size={15} />Use the order form</button>
          <button type="button" onClick={() => { setPrompt("I need 20 cases of 500 ml still water delivered to Cape Town."); document.getElementById("home-request")?.focus(); }}>Try an example</button>
        </div>
      </div>
      <figure className="sourcing-photo">
        <Image src="/cape-town-loading-bay.webp" alt="A Cape Town loading bay with Table Mountain in the distance" fill unoptimized preload />
        <figcaption><MapPin size={13} aria-hidden="true" />Cape Town, South Africa</figcaption>
      </figure>
    </section>}
    <section className="overview-totals" aria-label="Workspace totals">
      {metrics.filter(({ view }) => role === "reviewer" ? view === "orders" : role === "driver" ? ["orders", "deliveries"].includes(view) : true).map(({ label, value, icon: Icon, view }) =>
        <button type="button" className="overview-total" key={label} onClick={() => navigate(view)}>
          <Icon className="overview-total-icon" size={19} aria-hidden="true" />
          <ArrowUpRight className="overview-total-arrow" size={16} aria-hidden="true" />
          <strong>{number(value)}</strong>
          <span>{label}</span>
        </button>)}
    </section>
    <div className="dashboard-grid dashboard-work">
      <section className="card panel">
        <PanelTitle title="Recent activity" subtitle="Latest requests and order updates" action={<TextButton onClick={() => navigate("orders")}>View orders</TextButton>} />
        {activity.length ? activity.map(({ key, title, detail, status, view, icon: Icon }) => <button key={key} type="button" className="activity-row" onClick={() => navigate(view, key)}><span className="icon-tile mint"><Icon size={16} /></span><div><strong>{title}</strong><p>{detail}</p></div><Tag value={status} /><ArrowUpRight size={15} /></button>) : <Empty title="Your activity will appear here" detail="Create a purchasing request or open the marketplace to get started." />}
      </section>
      <section className="card panel">
        <PanelTitle title="Quick actions" />
        {quickActions.map(({ title, detail, tint, icon: Icon, action }) => <button key={title} className="quick-row" type="button" onClick={action}><span className={`icon-tile ${tint}`}><Icon size={16} /></span><div><strong>{title}</strong><p>{detail}</p></div><ArrowRight size={15} /></button>)}
        {(pendingApproval > 0 || disputes > 0 || lowStock > 0) && <div className="small-stack attention-links">
          {pendingApproval > 0 && <TextButton onClick={() => navigate("orders")}>{pendingApproval} awaiting approval</TextButton>}
          {disputes > 0 && <TextButton onClick={() => navigate(state.actor?.role === "reviewer" ? "admin" : "orders")}>{disputes} open disputes</TextButton>}
          {lowStock > 0 && <TextButton onClick={() => navigate("inventory")}>{lowStock} low-stock listings</TextButton>}
        </div>}
      </section>
    </div>
  </div>;
}

export function SearchProgress({ title, detail }: { title: string; detail: string }) {
  return <div className="search-progress" role="status" aria-live="polite"><div className="progress-heading"><div className="radar" aria-hidden="true"><Search size={19} /></div><div><strong>{title}</strong><p>{detail}</p></div></div><div className="search-progress-track" aria-hidden="true" /></div>;
}

function RequestForm({ draft, setDraft, onSubmit, disabled }: { draft: RequestDraft; setDraft: (draft: RequestDraft) => void; onSubmit: () => Promise<void>; disabled: boolean }) {
  const update = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => setDraft({ ...draft, [key]: value });
  return <form className="stack" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
    {draft.missing && draft.missing.length > 0 && <div className="notice notice-warn"><ClipboardList size={16} />Check {draft.missing.join(", ")} before searching.</div>}
    <div className="form-grid">
      <label className="field full">Product and specification<input required value={draft.product} onChange={(event) => update("product", event.currentTarget.value)} maxLength={180} /></label>
      <label className="field">Quantity<input type="number" min="1" max="100000" required value={draft.quantity || ""} onChange={(event) => update("quantity", Number(event.currentTarget.value))} /></label>
      <label className="field">Unit<input value={draft.unit} required maxLength={40} onChange={(event) => update("unit", event.currentTarget.value)} /></label>
      <label className="field">Units per pack<input type="number" min="1" max="100000" value={draft.packSize ?? ""} onChange={(event) => update("packSize", event.currentTarget.value ? Number(event.currentTarget.value) : undefined)} /></label>
      <label className="field">Category<input value={draft.category} maxLength={80} onChange={(event) => update("category", event.currentTarget.value)} /></label>
      <label className="field">Delivery area or collection location<input required={!draft.collection} value={draft.location} maxLength={220} onChange={(event) => update("location", event.currentTarget.value)} /></label>
      <label className="field">Required by<input type="date" required value={draft.requiredDate} onChange={(event) => update("requiredDate", event.currentTarget.value)} /></label>
      <label className="field">Budget in rand<input type="number" min="0" max="1000000" step="0.01" value={draft.budgetCents == null ? "" : draft.budgetCents / 100} onChange={(event) => update("budgetCents", event.currentTarget.value ? cents(event.currentTarget.value) : null)} /><small>Private unless you choose to share it.</small></label>
      <label className="field">Fulfilment<select value={draft.collection ? "collection" : "delivery"} onChange={(event) => update("collection", event.currentTarget.value === "collection")}><option value="delivery">Delivery</option><option value="collection">Collection</option></select></label>
      <label className="field full">Additional requirements<textarea value={draft.notes} maxLength={1500} onChange={(event) => update("notes", event.currentTarget.value)} /></label>
      <label className="check"><input type="checkbox" checked={draft.substitutions} onChange={(event) => update("substitutions", event.currentTarget.checked)} />Allow suppliers to propose substitutions</label>
      <label className="check"><input type="checkbox" checked={!!draft.shareBudget} onChange={(event) => update("shareBudget", event.currentTarget.checked)} />Share my budget with suppliers</label>
    </div>
    <div className="button-row"><button type="submit" className="primary" disabled={disabled}><Search size={16} />Find suppliers</button></div>
  </form>;
}

export function Assistant({ state, prompt, setPrompt, draft, setDraft, busy, generate, navigate, run }: ComposerProps & { run: RunAction }) {
  const [lastPrompt, setLastPrompt] = useState("");
  const company = companyOf(state, state.actor?.companyId);

  function onPrompt(event: FormEvent) {
    event.preventDefault();
    setLastPrompt(prompt.trim());
    void generate();
  }

  async function match() {
    if (!draft) return;
    const result = await run<PurchaseRequest>("createRequest", { draft });
    if (!result) return;
    const request = result.data ?? result.state.requests.find((item) => item.buyerId === state.actor?.companyId && item.status === "draft");
    if (!request) return;
    setDraft(null);
    navigate("requests", request.id);
    await run("matchRequest", { requestId: request.id });
  }

  return <>
    <ViewTitle title="Source stock" subtitle="Type, speak or enter the details of your purchase request." action={<Tag value={state.aiMode === "cloudflare" ? "Cloudflare AI" : "Demo assistant"} variant={state.aiMode === "cloudflare" ? "green" : "amber"} />} />
    <div className="workspace-grid">
      <section className="card panel stack">
        <PanelTitle title="Purchasing assistant" subtitle="What does your business need?" />
        {(lastPrompt || draft?.mode === "cloudflare" || draft?.mode === "demo") && <div className="chat-bubble"><strong>Your requirement</strong><p>{lastPrompt || prompt}</p></div>}
        {busy === "draftRequest" && <SearchProgress title="Preparing your request" detail="Reading your requirement and checking the details to review." />}
        <form className="small-stack" onSubmit={onPrompt}>
          <label className="field">Describe the goods you need<textarea className="composer-text" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} maxLength={2000} placeholder="I need 20 cases of 500 ml still water delivered to Cape Town." required /></label>
          <div className="button-row"><Voice onTranscript={setPrompt} disabled={!!busy} preferCloudflare={state.aiMode === "cloudflare"} /><button className="primary" type="submit" disabled={!!busy}>Build request<ArrowRight size={16} /></button></div>
        </form>
        <button className="secondary" type="button" onClick={() => setDraft(freshDraft(company?.location))} disabled={!!busy}><ClipboardList size={16} />Use guided form</button>
      </section>
      <section className="card panel">
        <PanelTitle title="Review your request" subtitle="Check quantities, dates and delivery details before finding suppliers." />
        {draft ? <RequestForm draft={draft} setDraft={setDraft} onSubmit={match} disabled={!!busy} /> : <Empty title="No request to review yet" detail="Describe what you need or open the guided form." icon={AudioLines} />}
      </section>
    </div>
  </>;
}
