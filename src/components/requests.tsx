"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Check, ClipboardList, FileCheck2, MessageSquare, Search, Send, ShieldCheck, Store } from "lucide-react";
import type { MarketplaceState, Order, PurchaseRequest, Quote } from "../shared/marketplace";
import { cents, companyName, companyOf, type Navigate, type RunAction } from "./client";
import { SearchProgress } from "./purchasing";
import { Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, number } from "./ui";

export function Requests({ state, selected, busy, run, navigate }: { state: MarketplaceState; selected: string; busy: string; run: RunAction; navigate: Navigate }) {
  const request = state.requests.find((item) => item.id === selected) ?? state.requests[0];
  const canBuy = companyOf(state, state.actor?.companyId)?.capabilities.includes("buyer") && ["owner", "purchaser"].includes(state.actor?.role ?? "");
  const searching = request?.status === "matching" || busy === "matchRequest";
  const matchCount = request?.matches.length ?? 0;
  return <>
    <ViewTitle title="Requests & quotes" subtitle="Track supplier invitations and compare the terms you receive." action={canBuy ? <button className="primary" type="button" onClick={() => navigate("assistant")}><ClipboardList size={16} />New request</button> : undefined} />
    {searching ? <SearchProgress title="Finding matching suppliers" detail="Checking stock, quantities, delivery coverage and your required date." /> :
      request?.status === "matched" && <SearchProgress key={request.id} complete title="Supplier search complete"
        detail={matchCount ? number(matchCount) + (matchCount === 1 ? " matching supplier ready to review." : " matching suppliers ready to review.") : "No suppliers matched this request."} />}
    <div className="workspace-grid">
      <section className="card panel small-stack workspace-selector">
        <PanelTitle title="Purchase requests" subtitle={`${number(state.requests.length)} in this workspace`} />
        {state.requests.map((item) => <button key={item.id} type="button" className="list-button" aria-pressed={request?.id === item.id} onClick={() => navigate("requests", item.id)}><div><strong>{item.draft.product}</strong><small>{item.draft.quantity} {item.draft.unit} · {dateLabel(item.createdAt)}</small></div><Tag value={item.status} /></button>)}
        {!state.requests.length && <Empty title="No requests yet" detail="New purchasing requests and supplier invitations appear here." icon={ClipboardList} />}
      </section>
      {request && <RequestDetails key={request.id} state={state} request={request} busy={busy} run={run} navigate={navigate} />}
    </div>
  </>;
}

function RequestDetails({ state, request, busy, run, navigate }: { state: MarketplaceState; request: PurchaseRequest; busy: string; run: RunAction; navigate: Navigate }) {
  const [deselected, setDeselected] = useState<string[]>([]);
  const [sort, setSort] = useState("total");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [reply, setReply] = useState<"ask" | "decline" | null>(null);
  const [accept, setAccept] = useState<Quote | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);
  const { draft } = request;
  const buyer = state.actor?.companyId === request.buyerId;
  const buyerCanAct = buyer && ["owner", "purchaser"].includes(state.actor?.role ?? "");
  const supplier = !!state.actor && request.supplierIds.includes(state.actor.companyId) && !buyer && ["owner", "sales"].includes(state.actor.role);
  const supplierResponse = request.supplierResponses?.find((item) => item.supplierId === state.actor?.companyId);
  const matches = request.matches.filter((match, index) => request.matches.findIndex((item) => item.supplierId === match.supplierId) === index);
  const selectedMatches = matches.filter((match) => !deselected.includes(match.supplierId));
  const quotes = state.quotes.filter((quote) => quote.requestId === request.id && quote.status !== "superseded").sort((first, second) => {
    if (sort === "delivery") return first.deliveryDate.localeCompare(second.deliveryDate);
    if (sort === "match") return (request.matches.find((match) => match.supplierId === second.supplierId)?.score ?? 0) - (request.matches.find((match) => match.supplierId === first.supplierId)?.score ?? 0);
    return first.totalCents - second.totalCents;
  });

  async function acceptQuote() {
    if (!accept) return;
    const result = await run<Order>("acceptQuote", { quoteId: accept.id }, "Quote accepted and order created.");
    if (!result) return;
    const order = result.data ?? result.state.orders.find((item) => item.quoteId === accept.id);
    setAccept(null);
    if (order) navigate("orders", order.id);
  }

  return <div className="stack">
    <section className="card panel stack">
      <PanelTitle title={draft.product} subtitle={`Requested by ${companyName(state, request.buyerId)}`} action={<Tag value={request.status} />} />
      <dl className="details-grid"><div><dt>Quantity</dt><dd>{number(draft.quantity)} {draft.unit}</dd></div><div><dt>Required by</dt><dd>{dateLabel(draft.requiredDate)}</dd></div><div><dt>{draft.collection ? "Collection area" : "Delivery area"}</dt><dd>{draft.location}</dd></div><div><dt>Substitutions</dt><dd>{draft.substitutions ? "May propose" : "Exact goods required"}</dd></div>{draft.budgetCents !== null && (buyer || draft.shareBudget) && <div><dt>{draft.shareBudget ? "Shared budget" : "Private budget"}</dt><dd>{money(draft.budgetCents)}</dd></div>}{draft.packSize && draft.packSize > 1 && <div><dt>Pack size</dt><dd>{draft.packSize}</dd></div>}</dl>
      {draft.notes && <div className="subcard"><h3>Additional requirements</h3><p>{draft.notes}</p></div>}
      {buyerCanAct && request.status === "draft" && <div><button className="primary" type="button" disabled={!!busy} onClick={() => void run("matchRequest", { requestId: request.id })}><Search size={16} />Find matching suppliers</button></div>}
      {supplier && request.status === "sent" && (supplierResponse?.status === "declined" ? <p className="notice notice-warn">Your company declined this request.</p> : <div className="button-row"><button className="primary" type="button" disabled={!!busy} onClick={() => setQuoteOpen(true)}><FileCheck2 size={16} />{quotes.length ? "Revise quote" : "Prepare quote"}</button><button className="secondary" type="button" disabled={!!busy} onClick={() => setReply("ask")}><MessageSquare size={15} />Ask a question</button><button className="secondary" type="button" disabled={!!busy} onClick={() => setReply("decline")}>Decline request</button></div>)}
    </section>
    {buyer && request.status === "matched" && <section className="card panel stack">
      <PanelTitle title="Matching suppliers" subtitle="Review the matches and choose which suppliers should receive your request." />
      {matches.length === 0 && <Empty title="No suitable suppliers found" detail="Review product wording, availability or the delivery location, then try a new search." icon={Store} action={<button className="secondary" type="button" onClick={() => navigate("assistant")}>Open purchasing workspace</button>} />}
      {matches.map((match) => {
        const supplierCompany = companyOf(state, match.supplierId);
        const listing = state.listings.find((item) => item.id === match.listingId);
        return <label className="subcard check" key={match.supplierId}><input type="checkbox" checked={!deselected.includes(match.supplierId)} onChange={() => setDeselected((previous) => previous.includes(match.supplierId) ? previous.filter((id) => id !== match.supplierId) : [...previous, match.supplierId])} /><div><h3>{companyName(state, match.supplierId)}{supplierCompany?.verification.business === "verified" && <ShieldCheck size={14} className="inline-icon" aria-label={supplierCompany.demo ? "Demo verified" : "Verified business"} />}</h3><p>{listing?.name} {listing && `· ${listing.available} ${listing.unit} listed`}</p><p>{match.reasons.join(" · ")}</p></div></label>;
      })}
      {buyerCanAct && matches.length > 0 && <div><button className="primary" type="button" disabled={!!busy || !selectedMatches.length} onClick={() => void run("sendRequest", { requestId: request.id, supplierIds: selectedMatches.map((match) => match.supplierId) }, "Quote requests sent to the selected suppliers.")}><Send size={15} />Send to {selectedMatches.length} {selectedMatches.length === 1 ? "supplier" : "suppliers"}</button></div>}
    </section>}
    {buyer && !!request.supplierResponses?.length && <section className="card panel stack"><PanelTitle title="Invited suppliers" />{request.supplierResponses.map((item) => <div className="subcard split-line" key={item.supplierId}><div><h3>{companyName(state, item.supplierId)}</h3>{item.note && <p>{item.note}</p>}</div><Tag value={item.status} /></div>)}</section>}
    {(request.status === "sent" || request.status === "accepted" || quotes.length > 0) && <section className="card panel stack">
      <PanelTitle title={buyer ? "Compare quotes" : "Your quotes"} subtitle={buyer ? "Compare the exact terms each supplier submitted." : "Review your submitted versions and the current terms."} action={buyer && quotes.length > 1 ? <label className="field">Sort by<select value={sort} onChange={(event) => setSort(event.currentTarget.value)}><option value="total">Delivered total</option><option value="delivery">Delivery date</option><option value="match">Match quality</option></select></label> : undefined} />
      {!quotes.length && <Empty title={buyer ? "Waiting for quotes" : "No quote submitted yet"} detail={buyer ? `Your request was sent to ${request.supplierIds.length} ${request.supplierIds.length === 1 ? "supplier" : "suppliers"}. Responses appear here.` : "Prepare a quote from your available catalogue stock."} icon={FileCheck2} />}
      {quotes.map((quote) => {
        const listing = state.listings.find((item) => item.id === quote.listingId);
        const expired = quote.status === "submitted" && Date.parse(quote.expiresAt) <= clock;
        const canAccept = buyerCanAct && request.status === "sent" && quote.status === "submitted" && !expired;
        const packSize = quote.packSize ?? listing?.packSize;
        return <article key={quote.id} className="subcard small-stack"><div className="split-line"><div><h3>{companyName(state, quote.supplierId)}</h3><p>Version {quote.version} · {quote.product ?? listing?.name ?? draft.product}</p></div><Tag value={expired ? "expired" : quote.status} /></div>
          <dl className="details-grid"><div><dt>Delivered total</dt><dd>{money(quote.totalCents, quote.currency)}</dd></div><div><dt>Quoted quantity</dt><dd>{quote.quantity} {quote.unit ?? draft.unit}{packSize ? ` · ${packSize}/pack` : ""}</dd></div><div><dt>Unit price</dt><dd>{money(quote.unitPriceCents, quote.currency)}</dd></div><div><dt>Tax and delivery</dt><dd>{money(quote.taxCents, quote.currency)} + {money(quote.deliveryFeeCents, quote.currency)}</dd></div><div><dt>Delivery commitment</dt><dd>{dateLabel(quote.deliveryDate)}</dd></div><div><dt>Quote valid until</dt><dd>{dateLabel(quote.expiresAt)}</dd></div></dl>
          {quote.substitution && <p className="notice notice-warn">Supplier proposed a substitution.</p>}
          {quote.specification && <p>{quote.specification}</p>}
          {quote.notes && <p>{quote.notes}</p>}
          {canAccept && <div><button type="button" className="primary" disabled={!!busy} onClick={() => setAccept(quote)}>Review & accept<ArrowRight size={15} /></button></div>}
        </article>;
      })}
    </section>}
    {request.activity.length > 0 && <section className="card panel">
      <PanelTitle title="Request activity" />
      <ul className="timeline">{request.activity.toReversed().map((item, index) => <li key={`${item.at}-${index}`}><Check size={14} /><span>{item.title}</span><time dateTime={item.at}>{dateLabel(item.at)}</time></li>)}</ul>
    </section>}
    {quoteOpen && <QuoteForm state={state} request={request} busy={busy} run={run} onClose={() => setQuoteOpen(false)} />}
    {reply && <Dialog title={reply === "ask" ? "Ask the buyer a question" : "Decline quote request"} onClose={() => setReply(null)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (await run(reply === "ask" ? "askRequest" : "declineRequest", { requestId: request.id, body: fields.get("body") }, reply === "ask" ? "Question sent to the buyer." : "Request declined.")) setReply(null); }}><label className="field">{reply === "ask" ? "Question" : "Reason (optional)"}<textarea name="body" maxLength={1500} required={reply === "ask"} /></label><div><button className="primary" type="submit" disabled={!!busy}>{reply === "ask" ? "Send question" : "Decline request"}</button></div></form></Dialog>}
    {accept && <Dialog title="Accept this quote?" onClose={() => setAccept(null)}><div className="stack"><div className="notice"><FileCheck2 size={17} />This creates an order for {accept.quantity} {accept.unit ?? draft.unit} of {accept.product ?? draft.product} from {companyName(state, accept.supplierId)} at {money(accept.totalCents, accept.currency)} delivered. Version {accept.version} will be saved with the order.</div><div className="button-row"><button type="button" className="secondary" onClick={() => setAccept(null)}>Back to quotes</button><button type="button" className="primary" disabled={!!busy} onClick={() => void acceptQuote()}>Accept quote</button></div></div></Dialog>}
  </div>;
}

function QuoteForm({ state, request, busy, run, onClose }: { state: MarketplaceState; request: PurchaseRequest; busy: string; run: RunAction; onClose: () => void }) {
  const stock = state.listings.filter((listing) => listing.supplierId === state.actor?.companyId && !listing.archived);
  const defaultListing = stock.find((listing) => listing.id === request.matches.find((match) => match.supplierId === state.actor?.companyId)?.listingId) ?? stock[0];
  const [listingId, setListingId] = useState(defaultListing?.id ?? "");
  const [price, setPrice] = useState(defaultListing?.priceCents != null ? String(defaultListing.priceCents / 100) : "");
  const [fee, setFee] = useState(String((defaultListing?.deliveryFeeCents ?? 0) / 100));
  const [quantity, setQuantity] = useState(request.draft.quantity);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const result = await run("submitQuote", { requestId: request.id, listingId, quantity, unitPriceCents: cents(price), deliveryFeeCents: cents(fee), taxCents: cents(String(fields.get("tax") ?? "0")), deliveryDate: fields.get("deliveryDate"), expiresAt: fields.get("expiresAt"), notes: fields.get("notes") }, "Quote submitted.");
    if (result) onClose();
  }

  return <Dialog title="Prepare supplier quote" onClose={onClose}>
    {!stock.length ? <Empty title="No catalogue stock" detail="Create an active listing before quoting this request." /> : <form className="stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid"><label className="field full">Listing<select value={listingId} onChange={(event) => { const listing = stock.find((item) => item.id === event.currentTarget.value); if (!listing) return; setListingId(listing.id); setPrice(listing.priceCents == null ? "" : String(listing.priceCents / 100)); setFee(String(listing.deliveryFeeCents / 100)); }}>{stock.map((listing) => <option key={listing.id} value={listing.id}>{listing.name} · {listing.available} {listing.unit}</option>)}</select></label>
        <label className="field">Available quantity<input type="number" min="1" required value={quantity || ""} onChange={(event) => setQuantity(Number(event.currentTarget.value))} /></label>
        <label className="field">Unit price (ZAR)<input type="number" min="0.01" step="0.01" required value={price} onChange={(event) => setPrice(event.currentTarget.value)} /></label>
        <label className="field">Tax total (ZAR)<input type="number" name="tax" min="0" step="0.01" defaultValue="0" required /></label>
        <label className="field">Delivery fee (ZAR)<input type="number" min="0" step="0.01" required value={fee} onChange={(event) => setFee(event.currentTarget.value)} /></label>
        <label className="field">Deliver by<input type="date" name="deliveryDate" required defaultValue={request.draft.requiredDate} /></label>
        <label className="field">Quote expires<input type="date" name="expiresAt" /></label>
        <label className="field full">Terms or proposed substitutions<textarea name="notes" maxLength={1500} /></label>
      </div>
      <div className="notice"><CalendarDays size={16} />Check stock, quantity and the delivery commitment before submitting.</div>
      <div><button className="primary" type="submit" disabled={!!busy}><Send size={15} />Submit quote</button></div>
    </form>}
  </Dialog>;
}
