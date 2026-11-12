"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, AlertTriangle, Check, ClipboardCheck, Download, FileText, PackageCheck, Paperclip, QrCode, RotateCw, Send, Star, Truck, Wallet } from "lucide-react";
import type { DeliveryAuthorization, MarketplaceState, Order, OrderTransaction, RequestDraft } from "../shared/marketplace";
import { deliveryAmountCents } from "../integrations/escrow/shared";
import { AuthorizeTestnetDelivery, OrderFunding } from "../integrations/escrow/controls";
import { companyName, csv, download, type Navigate, type RunAction } from "./client";
import { QrDialog } from "./delivery-qr";
import { Busy, Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, number } from "./ui";

type OrderProps = { state: MarketplaceState; order: Order; busy: string; run: RunAction; navigate: Navigate; startDraft: (draft: RequestDraft) => void };

function receipt(order: Order, transaction?: OrderTransaction) {
  const lines = ["StockPact order record", `Order ${order.reference}`, `Goods: ${order.product}`, `Quantity: ${order.quantity} ${order.unit}`, `Delivery: ${order.location} · ${dateLabel(order.deliveryDate)}`, `Quoted total: ${money(order.totalCents)} ZAR`, ""];
  for (const item of transaction ? [transaction] : order.transactions) {
    const amount = item.mode === "demo" ? `${money(item.amountCents)} demo value` : `${(item.amountCents / 100).toFixed(2)} nominal test tokens`;
    lines.push(`${item.kind.toUpperCase()} · ${item.status} · ${amount} · ${dateLabel(item.createdAt)} · ${item.hash ?? "Simulated record"}`);
  }
  lines.push("", "This order record is not a tax invoice.");
  download(`${order.reference}${transaction ? `-${transaction.kind}-receipt` : "-summary"}.txt`, lines.join("\n"));
}

export function Orders({ state, selected, busy, run, navigate, startDraft }: Omit<OrderProps, "order"> & { selected: string }) {
  const [query, setQuery] = useState("");
  const orders = state.orders.filter((item) => `${item.product} ${item.reference} ${item.status}`.toLowerCase().includes(query.trim().toLowerCase()));
  const order = orders.find((item) => item.id === selected) ?? orders[0];
  return <>
    <ViewTitle title="Orders" subtitle="Manage funding, dispatch, delivery acceptance and order records." />
    <div className="workspace-grid">
      <section className="card panel small-stack workspace-selector"><PanelTitle title="Order history" /><label className="field">Search orders<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Product, reference or status" /></label>
        {orders.map((item) => <button key={item.id} type="button" className="list-button" aria-pressed={order?.id === item.id} onClick={() => navigate("orders", item.id)}><div><strong>{item.product}</strong><small>{item.reference} · {money(item.totalCents)}</small></div><Tag value={item.status} /></button>)}
        {!orders.length && <Empty title={query ? "No matching orders" : "No orders yet"} detail={query ? "Try a different product or order reference." : "Accepted supplier quotes become orders."} icon={PackageCheck} />}
      </section>
      {order && <OrderDetail key={order.id} state={state} order={order} busy={busy} run={run} navigate={navigate} startDraft={startDraft} />}
    </div>
  </>;
}

function OrderDetail({ state, order, busy, run, navigate, startDraft }: OrderProps) {
  const [dialog, setDialog] = useState<"accept" | "fund" | "review" | "dispute" | "driver" | "cancel" | null>(null);
  const [authorization, setAuthorization] = useState<DeliveryAuthorization | null>(null);
  const [message, setMessage] = useState("");
  const buyer = state.actor?.companyId === order.buyerId;
  const supplier = state.actor?.companyId === order.supplierId;
  const buyerRole = state.actor?.role ?? "";
  const purchasing = buyer && ["owner", "purchaser"].includes(buyerRole);
  const canPay = buyer && ["owner", "approver"].includes(buyerRole);
  const sales = supplier && ["owner", "sales"].includes(state.actor?.role ?? "");
  const canInspect = canPay && ["dispatched", "partial"].includes(order.status);
  const testnet = (order.paymentMode ?? state.escrow.mode) === "testnet";
  const outstanding = order.quantity - order.acceptedQuantity - (order.refundedQuantity ?? 0);
  const activeAuthorization = order.activeAuthorization;
  const driverList = state.team.filter((member) => member.role === "driver");
  const dispute = state.disputes.find((item) => item.orderId === order.id && item.status === "open");

  async function post(event: FormEvent) {
    event.preventDefault();
    if (await run("postMessage", { orderId: order.id, body: message })) setMessage("");
  }

  async function reorder() {
    const result = await run<RequestDraft>("reorder", { orderId: order.id });
    if (result?.data) startDraft(result.data);
  }

  return <div className="stack">
    <section className="card panel stack">
      <PanelTitle title={order.product} subtitle={`${order.reference} · ${companyName(state, order.buyerId)} → ${companyName(state, order.supplierId)}`} action={<Tag value={order.status} />} />
      <dl className="details-grid"><div><dt>Quoted total</dt><dd>{money(order.totalCents, order.currency)}</dd></div><div><dt>Accepted quantity</dt><dd>{number(order.acceptedQuantity)} / {number(order.quantity)} {order.unit}</dd></div><div><dt>Delivery area</dt><dd>{order.location}</dd></div><div><dt>Delivery commitment</dt><dd>{dateLabel(order.deliveryDate)}</dd></div><div><dt>Funds held</dt><dd>{testnet ? `${((order.fundedCents - order.releasedCents - order.refundedCents) / 100).toFixed(2)} test tokens` : money(order.fundedCents - order.releasedCents - order.refundedCents, order.currency)}</dd></div><div><dt>Released</dt><dd>{testnet ? `${(order.releasedCents / 100).toFixed(2)} test tokens` : money(order.releasedCents, order.currency)}</dd></div>{order.refundedQuantity ? <div><dt>Refunded quantity</dt><dd>{number(order.refundedQuantity)} {order.unit}</dd></div> : null}{order.packSize ? <div><dt>Pack size</dt><dd>{order.packSize} per pack</dd></div> : null}</dl>
      {order.specification && <div className="subcard"><h3>Accepted specification</h3><p>{order.specification}</p></div>}
      {dispute && <div className="notice notice-warn"><AlertTriangle size={17} /><div><strong>Dispute open · {money(dispute.amountCents)} of quoted value</strong><p>{dispute.reason}</p></div></div>}
      {order.activeAuthorization && <div className="notice"><QrCode size={17} /><div><strong>{order.activeAuthorization.quantity} {order.unit} authorised</strong><p>The supplier or authorised driver can accept the handover before the QR expires.</p></div></div>}
      <div className="button-row">
        {canPay && order.status === "approval" && <button type="button" className="primary" disabled={!!busy} onClick={() => void run("approveOrder", { orderId: order.id }, "Purchase approved.")}><ClipboardCheck size={16} />Approve purchase</button>}
        {canPay && order.status === "awaiting_funding" && (testnet ? <OrderFunding state={state} order={order} busy={busy} run={run} /> : state.actor?.demoRole ? <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("fund")}><Wallet size={16} />Reserve demo funds</button> : <div className="notice notice-warn"><Wallet size={16} />Testnet funding is unavailable for this company.</div>)}
        {canPay && ["approval", "awaiting_funding"].includes(order.status) && !order.transactions.some((item) => item.status === "pending") && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("cancel")}>Cancel order</button>}
        {sales && order.status === "funded" && <button type="button" className="primary" disabled={!!busy} onClick={() => void run("dispatchOrder", { orderId: order.id }, "Order marked dispatched.")}><Truck size={16} />Dispatch goods</button>}
        {sales && !testnet && ["funded", "dispatched", "partial"].includes(order.status) && driverList.length > 0 && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("driver")}><Truck size={16} />{order.driverId ? "Change driver" : "Assign driver"}</button>}
        {canInspect && !order.activeAuthorization && outstanding > 0 && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("accept")}><QrCode size={16} />Inspect goods & generate QR</button>}
        {canInspect && activeAuthorization && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("accept")}><QrCode size={16} />Reopen handover QR</button>}
        {canInspect && order.activeAuthorization && !testnet && <button type="button" className="secondary" disabled={!!busy} onClick={() => void run("cancelDelivery", { orderId: order.id }, "Handover authorisation cancelled.")}><RotateCw size={16} />Cancel current QR</button>}
        {!buyer && (sales || state.actor?.id === order.driverId) && ["dispatched", "partial"].includes(order.status) && <button type="button" className="primary" onClick={() => navigate("deliveries", "scan")}><QrCode size={16} />Scan handover QR</button>}
        {purchasing && order.status === "completed" && !order.reviewId && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("review")}><Star size={16} />Leave review</button>}
        {purchasing && order.status === "completed" && <button type="button" className="secondary" disabled={!!busy} onClick={() => void reorder()}><RotateCw size={16} />Buy again</button>}
        {(purchasing || canPay || sales) && ["dispatched", "partial"].includes(order.status) && !dispute && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("dispute")}><AlertTriangle size={16} />Report an issue</button>}
        <button type="button" className="secondary" onClick={() => receipt(order)}><Download size={16} />Order summary</button>
      </div>
    </section>
    {order.transactions.length > 0 && <section className="card panel"><PanelTitle title="Payment activity" subtitle="Track settlement status and download confirmed records." /><TransactionList order={order} /></section>}
    <section className="card panel stack"><PanelTitle title="Order conversation" />
      {order.messages.length ? <div className="small-stack">{order.messages.map((item) => <div key={item.id} className="subcard"><div className="split-line"><h3>{item.author}</h3><time className="small-note" dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><p>{item.body}</p></div>)}</div> : <p className="small-note">No messages yet.</p>}
      {(buyer || supplier || state.actor?.id === order.driverId) && <form className="small-stack" onSubmit={(event) => void post(event)}><label className="field">Message<textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} maxLength={2000} required placeholder="Ask about delivery or share an order update" /></label><div><button className="secondary" type="submit" disabled={!!busy || !message.trim()}><Send size={15} />Send message</button></div></form>}
    </section>
    <OrderAttachments orderId={order.id} canUpload={buyer || supplier || state.actor?.id === order.driverId} />
    <section className="card panel"><PanelTitle title="Order timeline" /><ul className="timeline">{order.timeline.toReversed().map((item, index) => <li key={`${item.at}-${index}`}><Check size={14} /><span>{item.title}</span><time dateTime={item.at}>{dateLabel(item.at)}</time></li>)}</ul></section>
    {dialog === "fund" && <Dialog title="Reserve demo funds" onClose={() => setDialog(null)}><div className="stack"><p className="notice notice-warn"><Wallet size={17} />Record a simulated reserve of {money(order.totalCents)} for {order.reference}. No wallet transaction will be made.</p><div><button type="button" className="primary" disabled={!!busy} onClick={async () => { if (await run("fundOrder", { orderId: order.id }, "Demo funds reserved.")) setDialog(null); }}>Confirm demo reserve</button></div></div></Dialog>}
    {dialog === "cancel" && <Dialog title="Cancel this order?" onClose={() => setDialog(null)}><div className="stack"><p className="notice notice-warn"><AlertTriangle size={17} />This cancels {order.reference} and returns reserved stock to the supplier.</p><div><button type="button" className="danger" disabled={!!busy} onClick={async () => { if (await run("cancelOrder", { orderId: order.id }, "Order cancelled and stock reservation released.")) setDialog(null); }}>Confirm cancellation</button></div></div></Dialog>}
    {dialog === "accept" && <AcceptanceForm state={state} order={order} busy={busy} run={run} onClose={() => setDialog(null)} onAuthorized={(data) => { setDialog(null); setAuthorization(data); }} />}
    {dialog === "review" && <OrderForm dialog="review" order={order} busy={busy} run={run} onClose={() => setDialog(null)} />}
    {dialog === "dispute" && <OrderForm dialog="dispute" order={order} busy={busy} run={run} onClose={() => setDialog(null)} />}
    {dialog === "driver" && <OrderForm dialog="driver" order={order} busy={busy} run={run} drivers={driverList} onClose={() => setDialog(null)} />}
    {authorization && <QrDialog authorization={authorization} mode={testnet ? "testnet" : "demo"} onClose={() => setAuthorization(null)} />}
  </div>;
}

function AcceptanceForm({ state, order, busy, run, onClose, onAuthorized }: { state: MarketplaceState; order: Order; busy: string; run: RunAction; onClose: () => void; onAuthorized: (authorization: DeliveryAuthorization) => void }) {
  const settled = order.acceptedQuantity + (order.refundedQuantity ?? 0);
  const remaining = order.quantity - settled;
  const [existingQuantity] = useState(order.activeAuthorization?.quantity);
  const [quantity, setQuantity] = useState(existingQuantity ?? remaining);
  const testnet = (order.paymentMode ?? state.escrow.mode) === "testnet";
  const valid = Number.isInteger(quantity) && quantity > 0 && quantity <= remaining;
  const amount = valid ? deliveryAmountCents(order.totalCents, order.quantity, settled, quantity) : 0;
  const canAuthorize = valid && amount > 0 && !busy;

  async function authorize(event: FormEvent) {
    event.preventDefault();
    if (!canAuthorize || testnet) return;
    const result = await run<DeliveryAuthorization>("authorizeDelivery", { orderId: order.id, quantity });
    if (result?.data) onAuthorized({ ...result.data, orderId: order.id, quantity, status: "active" });
  }

  return <Dialog title="Inspect delivered goods" onClose={onClose}><form className="stack" onSubmit={(event) => void authorize(event)}><p className="small-note">Accept only the goods you checked. The remaining {order.unit} stay outstanding.</p><label className="field">Accepted {order.unit}<input type="number" min="1" max={remaining} required readOnly={existingQuantity != null} value={quantity || ""} onChange={(event) => setQuantity(Number(event.currentTarget.value))} /></label>
    <div className="notice"><QrCode size={17} /><div><strong>Authorised {testnet ? "testnet release" : "demo release"} {testnet ? `${(amount / 100).toFixed(2)} test tokens` : money(amount)}</strong><p>{testnet ? "The supplier accepts the single-use QR with its linked wallet." : "The supplier or authorised driver must accept the single-use QR to proceed."}</p></div></div>
    {testnet ? <AuthorizeTestnetDelivery state={state} order={order} quantity={quantity} busy={busy} run={run} onAuthorized={onAuthorized} /> : <div><button type="submit" className="primary" disabled={!canAuthorize}><QrCode size={16} />{existingQuantity != null ? "Show handover QR" : "Authorise & generate QR"}</button></div>}
  </form></Dialog>;
}

function OrderForm({ dialog, order, busy, run, drivers = [], onClose }: { dialog: "review" | "dispute" | "driver"; order: Order; busy: string; run: RunAction; drivers?: { id: string; name: string }[]; onClose: () => void }) {
  const ratings = [["rating", "Overall"], ["quality", "Product quality"], ["reliability", "Delivery reliability"], ["accuracy", "Order accuracy"], ["communication", "Communication"]];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const action = dialog === "review" ? "reviewOrder" : dialog === "dispute" ? "openDispute" : "assignDriver";
    const values = dialog === "review" ? { ...Object.fromEntries(ratings.map(([key]) => [key, Number(fields.get(key))])), comment: fields.get("comment") } : dialog === "dispute" ? { quantity: Number(fields.get("quantity")), reason: fields.get("reason") } : { driverId: fields.get("driverId") };
    const result = await run(action, { orderId: order.id, ...values }, dialog === "review" ? "Verified-order review published." : dialog === "dispute" ? "Dispute opened for review." : "Delivery driver assigned.");
    if (result) onClose();
  }
  return <Dialog title={dialog === "review" ? "Review supplier" : dialog === "dispute" ? "Report a delivery issue" : "Assign delivery driver"} onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}>
    {dialog === "review" && <div className="form-grid">{ratings.map(([key, label]) => <label key={key} className="field">{label}<select name={key} defaultValue="5">{[5, 4, 3, 2, 1].map((stars) => <option key={stars} value={stars}>{stars} / 5</option>)}</select></label>)}<label className="field full">Comment<textarea name="comment" minLength={2} maxLength={1500} required /></label></div>}
    {dialog === "dispute" && <><label className="field">Disputed {order.unit}<input type="number" min="1" max={order.quantity - order.acceptedQuantity - (order.refundedQuantity ?? 0)} name="quantity" required /></label><label className="field">Reason<textarea name="reason" minLength={4} maxLength={1800} required placeholder="Describe missing, damaged or rejected goods" /></label></>}
    {dialog === "driver" && <label className="field">Authorised driver<select name="driverId" defaultValue={order.driverId ?? ""} required><option value="" disabled>Choose a driver</option>{drivers.map((driver) => <option value={driver.id} key={driver.id}>{driver.name}</option>)}</select></label>}
    <div><button type="submit" className="primary" disabled={!!busy}>{dialog === "review" ? "Publish review" : dialog === "dispute" ? "Submit dispute" : "Assign driver"}</button></div>
  </form></Dialog>;
}

type Attachment = { id: string; name: string; size: number; url: string; createdAt: string };

function OrderAttachments({ orderId, canUpload }: { orderId: string; canUpload: boolean }) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/attachments?orderId=${encodeURIComponent(orderId)}`, { signal: abort.signal }).then(async (response) => {
      const data = await response.json() as { attachments?: Attachment[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Attachments are unavailable.");
      setAttachments(data.attachments ?? []);
    }).catch((caught) => { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Attachments are unavailable."); });
    return () => abort.abort();
  }, [orderId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.append("orderId", orderId);
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/attachments", { method: "POST", body: data });
      const result = await response.json() as { attachment?: Attachment; error?: string };
      if (!response.ok || !result.attachment) throw new Error(result.error ?? "Upload failed. Try again.");
      const attachment = result.attachment;
      setAttachments((previous) => [attachment, ...(previous ?? [])]);
      form.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed. Try again."); }
    finally { setUploading(false); }
  }

  return <section className="card panel stack"><PanelTitle title="Private attachments" subtitle="Order evidence, supplier invoices and handover documents." />
    {error && <p role="alert" className="notice notice-error"><AlertCircle size={16} />{error}</p>}
    {!attachments && !error && <Busy label="Checking attachments" />}
    {attachments?.length === 0 && <p className="small-note">No attachments yet.</p>}
    {attachments?.map((attachment) => <a className="attachment-link" key={attachment.id} href={attachment.url}><Paperclip size={16} /><span>{attachment.name}</span><span>{Math.ceil(attachment.size / 1024)} KB</span><Download size={15} /></a>)}
    {canUpload && <form className="small-stack" onSubmit={(event) => void upload(event)}><label className="field">Attach a file<input type="file" accept=".pdf,.png,.jpeg,.jpg,.webp" name="file" required /><small>PDF, JPEG, PNG or WebP, up to 8 MB.</small></label><div><button className="secondary" type="submit" disabled={uploading}><Paperclip size={15} />{uploading ? "Uploading…" : "Upload attachment"}</button></div></form>}
  </section>;
}

function TransactionList({ order }: { order: Order }) {
  return <div className="small-stack">{order.transactions.toReversed().map((transaction) => <div key={transaction.id} className="subcard small-stack"><div className="split-line"><div><h3>{transaction.kind.charAt(0).toUpperCase() + transaction.kind.slice(1)}</h3><p>{dateLabel(transaction.createdAt)} · {transaction.mode === "demo" ? "Demo simulation" : "Testnet"}</p></div><Tag value={transaction.status} /></div><div className="split-line"><strong>{transaction.mode === "demo" ? money(transaction.amountCents) : `${(transaction.amountCents / 100).toFixed(2)} test tokens`}</strong>{transaction.status === "confirmed" && <button type="button" className="secondary" onClick={() => receipt(order, transaction)}><FileText size={15} />Receipt</button>}</div>{transaction.hash && <p className="transaction-hash">{transaction.hash}</p>}</div>)}</div>;
}

export function Funds({ state, navigate }: { state: MarketplaceState; navigate: Navigate }) {
  const total = (name: "fundedCents" | "releasedCents" | "refundedCents") => state.orders.filter((order) => (order.paymentMode ?? "demo") === state.escrow.mode).reduce((sum, order) => sum + order[name], 0);
  const testnet = state.escrow.mode === "testnet";
  const format = (value: number) => testnet ? `${(value / 100).toFixed(2)} test tokens` : money(value);
  const records = state.orders.filter((order) => order.transactions.length);
  const exportCsv = () => download("stockpact-transactions.csv", csv([["Order", "Type", "Mode", "Status", "Nominal cents", "Quantity", "Transaction hash", "Created"], ...records.flatMap((order) => order.transactions.map((item) => [order.reference, item.kind, item.mode, item.status, item.amountCents, item.quantity, item.hash, item.createdAt]))]), "text/csv;charset=utf-8");
  return <>
    <ViewTitle title="Funds & transactions" subtitle="Review escrow reserves, releases, refunds and settlement status." action={<button className="secondary" type="button" disabled={!records.length} onClick={exportCsv}><Download size={16} />Export CSV</button>} />
    <div className="stack">
      <div className="notice notice-warn"><Wallet size={17} />{testnet ? "Settlement uses the configured testnet token. Rand quote totals are nominal references and do not include wallet network fees." : "Demo funds are simulated. This workspace does not use a wallet or move money."}</div>
      <div className="fund-metrics">{[["Reserved now", total("fundedCents") - total("releasedCents") - total("refundedCents")], ["Released", total("releasedCents")], ["Refunded", total("refundedCents")]].map(([label, amount]) => <section className="card panel" key={label}><p className="small-note">{label}</p><strong className="listing-price">{format(Number(amount))}</strong></section>)}</div>
      <section className="card panel stack"><PanelTitle title="Transaction history" />{records.length ? records.map((order) => <article className="subcard stack" key={order.id}><div className="split-line"><div><h3>{order.product}</h3><p>{order.reference}</p></div><button className="secondary" type="button" onClick={() => navigate("orders", order.id)}>Open order</button></div><TransactionList order={order} /></article>) : <Empty title="No transactions yet" detail="Funding, releases and refunds will appear here." icon={Wallet} />}</section>
    </div>
  </>;
}
