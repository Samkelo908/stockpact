"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowRight, CalendarDays, Check, ClipboardList, FileCheck2, MessageSquare, Search, Send, ShieldCheck, Store } from "lucide-react";
import type { MarketplaceState, Order, PurchaseRequest, Quote, RequestDraft } from "../shared/marketplace";
import { requestMessageLimit, type RequestConversation } from "../shared/request-chat";
import { cents, companyName, companyOf, type Navigate, type RunAction } from "./client";
import { SearchProgress } from "./purchasing";
import { Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, number } from "./ui";
import "./request-chat.css";

const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
const localMessageTime = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

export function Requests({ state, selected, busy, run, navigate, startDraft }: { state: MarketplaceState; selected: string; busy: string; run: RunAction; navigate: Navigate; startDraft: (draft: RequestDraft) => void }) {
  const [selectedRequest, section, supplierId] = selected.split("/");
  const request = state.requests.find((item) => item.id === selectedRequest) ?? state.requests[0];
  const chatSupplier = request?.id === selectedRequest && section === "chat" ? supplierId : undefined;
  const siblings = request?.group ? state.requests.filter((item) => item.group?.id === request.group?.id).sort((a, b) => (a.group?.lineNumber ?? 0) - (b.group?.lineNumber ?? 0)) : [];
  const canBuy = companyOf(state, state.actor?.companyId)?.capabilities.includes("buyer") && ["owner", "purchaser"].includes(state.actor?.role ?? "");
  const searching = request?.status === "matching" || busy === "matchRequest";
  const matchCount = request?.matches.length ?? 0;
  return <>
    <ViewTitle title="Requests & quotes" subtitle="Track supplier invitations and compare the terms you receive." action={canBuy ? <button className="primary" type="button" onClick={() => navigate("assistant")}><ClipboardList size={16} />New request</button> : undefined} />
    {searching && <SearchProgress title="Finding matching suppliers" detail="Checking stock, quantities, delivery coverage and your required date." />}
    {!searching && request?.status === "matched" && (
      <SearchProgress key={request.id} complete title="Supplier search complete"
        detail={matchCount ? number(matchCount) + (matchCount === 1 ? " matching supplier ready to review." : " matching suppliers ready to review.") : "No suppliers matched this request."}
        action={request.buyerId === state.actor?.companyId && (matchCount > 0 ? (
            <button type="button" className="primary" aria-controls="matching-suppliers" onClick={() => {
              const matches = document.getElementById("matching-suppliers");
              matches?.focus({ preventScroll: true });
              matches?.scrollIntoView({ block: "start" });
            }}>
              Review suppliers<ArrowDown size={16} aria-hidden="true" />
            </button>
          ) : canBuy && (
            <button type="button" className="primary" onClick={() => startDraft({ ...request.draft, mode: "manual" })}>
              Adjust and search again<ArrowRight size={16} aria-hidden="true" />
            </button>
          ))}
      />
    )}
    <div className="workspace-grid">
      <section className="card panel small-stack workspace-selector">
        <PanelTitle title="Purchase requests" subtitle={`${number(state.requests.length)} in this workspace`} />
        {state.requests.map((item) => <button key={item.id} type="button" className="list-button" aria-pressed={request?.id === item.id} onClick={() => navigate("requests", item.id)}><div><strong>{item.draft.product}</strong><small>{item.draft.quantity} {item.draft.unit} · {dateLabel(item.createdAt)}</small>{item.group && <small>{item.group.label} · Item {item.group.lineNumber} of {item.group.lineCount}</small>}</div><Tag value={item.status} /></button>)}
        {!state.requests.length && <Empty title="No requests yet" detail="New purchasing requests and supplier invitations appear here." icon={ClipboardList} />}
      </section>
      {request && <RequestDetails key={`${state.actor?.id}:${request.id}`} state={state} request={request} busy={busy} run={run} navigate={navigate} chatSupplier={chatSupplier} siblings={siblings} />}
    </div>
  </>;
}

function RequestDetails({ state, request, busy, run, navigate, chatSupplier, siblings }: { state: MarketplaceState; request: PurchaseRequest; busy: string; run: RunAction; navigate: Navigate; chatSupplier?: string; siblings: PurchaseRequest[] }) {
  const [deselected, setDeselected] = useState<string[]>([]);
  const [sort, setSort] = useState("total");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [decline, setDecline] = useState(false);
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
  const selectedResponse = request.supplierResponses?.find((item) => item.supplierId === chatSupplier && (buyer || (supplier && item.supplierId === state.actor?.companyId)));
  const canMessage = request.status === "sent" && draft.requiredDate >= localDay.format(new Date(clock));
  const chat = selectedResponse && request.conversations?.find((item) => item.supplierId === selectedResponse.supplierId);
  const openChat = (supplierId: string) => navigate("requests", `${request.id}/chat/${supplierId}`);
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
    {request.group && siblings.length > 1 && <section className="card panel small-stack"><PanelTitle title={request.group.label} subtitle={`Item ${request.group.lineNumber} of ${request.group.lineCount}. Each item has its own quotes and order.`} /><div className="request-group-items" aria-label="Items in this purchase request">{siblings.map((item) => <button className="list-button" key={item.id} type="button" aria-pressed={item.id === request.id} onClick={() => navigate("requests", item.id)}><div><strong>{item.group?.lineNumber}. {item.draft.product}</strong></div><Tag value={item.status} /></button>)}</div></section>}
    <section className="card panel stack">
      <PanelTitle title={draft.product} subtitle={`Requested by ${companyName(state, request.buyerId)}`} action={<Tag value={request.status} />} />
      <dl className="details-grid"><div><dt>Quantity</dt><dd>{number(draft.quantity)} {draft.unit}</dd></div><div><dt>Required by</dt><dd>{dateLabel(draft.requiredDate)}</dd></div><div><dt>{draft.collection ? "Collection area" : "Delivery area"}</dt><dd>{draft.location}</dd></div><div><dt>Substitutions</dt><dd>{draft.substitutions ? "May propose" : "Exact goods required"}</dd></div>{draft.budgetCents !== null && (buyer || draft.shareBudget) && <div><dt>{draft.shareBudget ? "Shared budget" : "Private budget"}</dt><dd>{money(draft.budgetCents)}</dd></div>}{draft.packSize && draft.packSize > 1 && <div><dt>Pack size</dt><dd>{draft.packSize}</dd></div>}</dl>
      {draft.notes && <div className="subcard"><h3>Additional requirements</h3><p>{draft.notes}</p></div>}
      {buyerCanAct && request.status === "draft" && <div><button className="primary" type="button" disabled={!!busy} onClick={() => void run("matchRequest", { requestId: request.id })}><Search size={16} />Find matching suppliers</button></div>}
      {supplier && <div className="small-stack">
        {supplierResponse?.status === "declined" && <p className="notice notice-warn">Your company declined this request.</p>}
        <div className="button-row">
          {canMessage && supplierResponse?.status !== "declined" && <button className="primary" type="button" disabled={!!busy} onClick={() => setQuoteOpen(true)}><FileCheck2 size={16} />{quotes.length ? "Revise quote" : "Prepare quote"}</button>}
          {supplierResponse && <button className="secondary" type="button" onClick={() => openChat(supplierResponse.supplierId)}><MessageSquare size={15} />Message buyer</button>}
          {canMessage && supplierResponse?.status !== "declined" && <button className="secondary" type="button" disabled={!!busy} onClick={() => setDecline(true)}>Decline request</button>}
        </div>
      </div>}
    </section>
    {buyer && request.status === "matched" && <section id="matching-suppliers" tabIndex={-1} aria-label="Matching suppliers" className="card panel stack">
      <PanelTitle title="Matching suppliers" subtitle="Review the matches and choose which suppliers should receive your request." />
      {matches.length === 0 && <Empty title="No suitable suppliers found" detail="Try adjusting the product, quantity or delivery area." icon={Store} />}
      {matches.map((match) => {
        const supplierCompany = companyOf(state, match.supplierId);
        const listing = state.listings.find((item) => item.id === match.listingId);
        return <label className="subcard check" key={match.supplierId}><input type="checkbox" checked={!deselected.includes(match.supplierId)} onChange={() => setDeselected((previous) => previous.includes(match.supplierId) ? previous.filter((id) => id !== match.supplierId) : [...previous, match.supplierId])} /><div><h3>{companyName(state, match.supplierId)}{supplierCompany?.verification.business === "verified" && <ShieldCheck size={14} className="inline-icon" aria-label={supplierCompany.demo ? "Demo verified" : "Verified business"} />}</h3><p>{listing?.name} {listing && `· ${listing.available} ${listing.unit} listed`}</p><p>{match.reasons.join(" · ")}</p></div></label>;
      })}
      {buyerCanAct && matches.length > 0 && <div><button className="primary" type="button" disabled={!!busy || !selectedMatches.length} onClick={() => void run("sendRequest", { requestId: request.id, supplierIds: selectedMatches.map((match) => match.supplierId) }, "Quote requests sent to the selected suppliers.")}><Send size={15} />Send to {selectedMatches.length} {selectedMatches.length === 1 ? "supplier" : "suppliers"}</button></div>}
    </section>}
    {buyer && !!request.supplierResponses?.length && <section className="card panel stack"><PanelTitle title="Invited suppliers" />{request.supplierResponses.map((item) => {
      const name = companyName(state, item.supplierId);
      return <div className="subcard small-stack" key={item.supplierId}><div className="split-line"><div><h3>{name}</h3>{item.note && <p>{item.note}</p>}</div><Tag value={item.status} /></div><div><button className="secondary" type="button" aria-label={`Message ${name}`} onClick={() => openChat(item.supplierId)}><MessageSquare size={15} />Message supplier</button></div></div>;
    })}</section>}
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
    {decline && <Dialog title="Decline quote request" onClose={() => setDecline(false)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (await run("declineRequest", { requestId: request.id, body: fields.get("body") }, "Request declined.")) setDecline(false); }}><label className="field">Reason (optional)<textarea name="body" maxLength={1500} /></label><div><button className="primary" type="submit" disabled={!!busy}>Decline request</button></div></form></Dialog>}
    {selectedResponse && state.actor && <RequestChat key={selectedResponse.supplierId} requestId={request.id} supplierId={selectedResponse.supplierId} actorCompanyId={state.actor.companyId} counterparty={companyName(state, buyer ? selectedResponse.supplierId : request.buyerId)} product={request.draft.product} conversation={chat} open={canMessage && selectedResponse.status !== "declined"} canWrite={buyerCanAct || supplier} busy={busy} run={run} onClose={() => navigate("requests", request.id)} />}
    {accept && <Dialog title="Accept this quote?" onClose={() => setAccept(null)}><div className="stack"><div className="notice"><FileCheck2 size={17} />This creates an order for {accept.quantity} {accept.unit ?? draft.unit} of {accept.product ?? draft.product} from {companyName(state, accept.supplierId)} at {money(accept.totalCents, accept.currency)} delivered. Version {accept.version} will be saved with the order.</div><div className="button-row"><button type="button" className="secondary" onClick={() => setAccept(null)}>Back to quotes</button><button type="button" className="primary" disabled={!!busy} onClick={() => void acceptQuote()}>Accept quote</button></div></div></Dialog>}
  </div>;
}

function RequestChat({ requestId, supplierId, actorCompanyId, counterparty, product, conversation, open, canWrite, busy, run, onClose }: {
  requestId: string; supplierId: string; actorCompanyId: string; counterparty: string; product: string; conversation?: RequestConversation;
  open: boolean; canWrite: boolean; busy: string; run: RunAction; onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [earlier, setEarlier] = useState<RequestConversation | null>(null);
  const [submitted, setSubmitted] = useState("");
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const stickToLatest = useRef(true);
  const pendingTop = useRef<number | null>(null);
  const liveMessages = conversation?.messages ?? [];
  const loaded = earlier?.messages ?? [];
  const messages = Array.from(new Map([...loaded, ...liveMessages].map((message) => [message.id, message])).values());
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;
  const hasEarlier = earlier ? earlier.hasEarlier : conversation?.hasEarlier;

  useEffect(() => {
    const viewport = log.current;
    if (!viewport) return;
    if (pendingTop.current !== null) {
      viewport.scrollTop = viewport.scrollHeight - pendingTop.current;
      pendingTop.current = null;
    } else if (stickToLatest.current) viewport.scrollTop = viewport.scrollHeight;
  }, [firstId, lastId]);

  async function showEarlier() {
    if (!firstId) return;
    const result = await run<RequestConversation>("readEarlierRequestMessages", { requestId, supplierId, beforeId: firstId });
    if (!result?.data) return;
    if (result.data.messages.length && log.current) pendingTop.current = log.current.scrollHeight - log.current.scrollTop;
    const page = result.data;
    setEarlier({ ...page, messages: [...page.messages, ...messages] });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = body.trim();
    if (!message || !open || !canWrite || busy) return;
    const identity = attempt.current?.body === message ? attempt.current : { body: message, id: crypto.randomUUID() };
    attempt.current = identity;
    setSubmitted("");
    stickToLatest.current = true;
    const result = await run("postRequestMessage", { requestId, supplierId, body: message, messageId: identity.id });
    if (!result) return;
    attempt.current = null;
    setBody((current) => current.trim() === message ? "" : current);
    setSubmitted("Message sent.");
  }

  return <Dialog title={`Conversation with ${counterparty}`} onClose={onClose}><div className="stack request-chat">
    <p className="small-note">{product} · Private to the buyer and this supplier.</p>
    <div ref={log} className="request-chat-log" role="log" aria-label="Request messages" tabIndex={0} onScroll={() => {
      const viewport = log.current;
      if (viewport) stickToLatest.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 64;
    }}>
      {hasEarlier && <div className="request-chat-earlier"><button className="secondary" type="button" disabled={!!busy} onClick={() => void showEarlier()}>Load earlier messages</button></div>}
      {messages.length ? <ul>{messages.map((message) => {
        const own = message.authorCompanyId === actorCompanyId;
        return <li key={message.id} className={own ? "request-chat-own" : undefined}><div className="request-chat-message"><div className="request-chat-byline"><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{localMessageTime.format(new Date(message.createdAt))}</time></div><p>{message.body}</p></div></li>;
      })}</ul> : <p className="small-note request-chat-empty">No messages yet.</p>}
    </div>
    {open && canWrite ? <form className="small-stack" onSubmit={(event) => void send(event)}>
      <label className="field">Message<textarea value={body} onChange={(event) => setBody(event.currentTarget.value)} maxLength={requestMessageLimit} rows={2} required placeholder="Ask about stock, delivery or the quote" /></label>
      <div><button className="primary" type="submit" disabled={!!busy || !body.trim()}><Send size={16} />{busy === "postRequestMessage" ? "Sending…" : "Send message"}</button></div>
      <p className="sr-only" role="status">{submitted}</p>
    </form> : <p className="small-note">{open ? "Your role can view this conversation." : "This request conversation is closed."}</p>}
  </div></Dialog>;
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
