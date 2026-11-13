"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, AlertTriangle, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ClipboardCheck, Download, FileText, LockKeyhole, PackageCheck, Paperclip, QrCode, RotateCw, Search, Send, ShieldCheck, Star, Truck, Wallet } from "lucide-react";
import type { DeliveryAuthorization, MarketplaceState, Order, OrderTransaction, RequestDraft } from "../shared/marketplace";
import { deliveryAmountCents } from "../integrations/escrow/shared";
import { AuthorizeTestnetDelivery, OrderFunding, RevokeTestnetDelivery } from "../integrations/escrow/controls";
import { companyName, csv, download, type Navigate, type RunAction } from "./client";
import { QrDialog } from "./delivery-qr";
import { Busy, Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, number } from "./ui";
import { isXrplAvailable, orderStateLabel, xrplAmount, XrplActivity, XrplCheckout } from "./xrpl-autopay";

type OrderProps = { state: MarketplaceState; order: Order; busy: string; run: RunAction; navigate: Navigate; startDraft: (draft: RequestDraft) => void };
type PaymentMode = OrderTransaction["mode"];

const transactionKinds = {
  funding: { label: "Escrow funding", filter: "Funding", icon: ArrowDownToLine },
  release: { label: "Supplier release", filter: "Releases", icon: ArrowUpRight },
  refund: { label: "Buyer refund", filter: "Refunds", icon: ArrowDownLeft },
} as const;

function paymentAmount(value: number, mode: PaymentMode, unit?: string, currency?: string) {
  return mode === "testnet" ? `${(value / 100).toFixed(2)} ${unit ?? "test tokens"}` : money(value, currency);
}

function receipt(order: Order, transaction?: OrderTransaction) {
  const lines = [transaction ? "StockPact payment receipt" : "StockPact order record", `Order ${order.reference}`, `Goods: ${order.product}`, `Quantity: ${order.quantity} ${order.unit}`, `Delivery: ${order.location} · ${dateLabel(order.deliveryDate)}`, `Quoted total: ${money(order.totalCents, order.currency)} (${order.currency ?? "ZAR"})`, ""];
  for (const item of transaction ? [transaction] : order.transactions) {
    const amount = paymentAmount(item.amountCents, item.mode, undefined, order.currency);
    lines.push(`${transactionKinds[item.kind].label} · ${item.status} · ${amount}`,
      `Record: ${item.id}`, `Date: ${dateLabel(item.createdAt)}`, `Mode: ${item.mode === "demo" ? "Simulated payment" : "Testnet"}`);
    if (item.quantity != null) lines.push(`Quantity: ${item.quantity} ${order.unit}`);
    if (item.hash) lines.push(`Transaction hash: ${item.hash}`);
    lines.push("");
  }
  lines.push("Tax invoices are issued by the supplier.");
  const suffix = transaction ? `-${transaction.kind}-receipt-${transaction.id.slice(-8)}` : "-summary";
  download(`${order.reference}${suffix}.txt`, lines.join("\n"));
}

export function Orders({ state, selected, busy, run, navigate, startDraft }: Omit<OrderProps, "order"> & { selected: string }) {
  const [query, setQuery] = useState("");
  const orders = state.orders.filter((item) => `${item.product} ${item.reference} ${orderStateLabel(item)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const order = orders.find((item) => item.id === selected) ?? orders[0];
  return <>
    <ViewTitle title="Orders" subtitle="Manage funding, dispatch, delivery acceptance and order records." />
    <div className="workspace-grid">
      <section className="card panel small-stack workspace-selector"><PanelTitle title="Order history" /><label className="field">Search orders<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Product, reference or status" /></label>
        {orders.map((item) => <button key={item.id} type="button" className="list-button" aria-pressed={order?.id === item.id} onClick={() => navigate("orders", item.id)}><div><strong>{item.product}</strong><small>{item.reference} · {money(item.totalCents)}</small></div><Tag value={orderStateLabel(item)} /></button>)}
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
  const paymentMode = order.paymentMode ?? state.escrow.mode;
  const xrpl = paymentMode === "xrpl";
  const testnet = paymentMode === "testnet";
  const canSettle = testnet || (state.escrow.mode === "demo" && state.actor?.demoRole);
  const canEnableXrpl = isXrplAvailable(state, order);
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
      <PanelTitle title={order.product} subtitle={`${order.reference} · ${companyName(state, order.buyerId)} → ${companyName(state, order.supplierId)}`} action={<Tag value={orderStateLabel(order)} />} />
      <dl className="details-grid"><div><dt>Quoted total</dt><dd>{money(order.totalCents, order.currency)}</dd></div><div><dt>Accepted quantity</dt><dd>{number(order.acceptedQuantity)} / {number(order.quantity)} {order.unit}</dd></div><div><dt>Delivery area</dt><dd>{order.location}</dd></div><div><dt>Delivery commitment</dt><dd>{dateLabel(order.deliveryDate)}</dd></div>{xrpl ? <><div><dt>Payment method</dt><dd>XRPL Testnet autopay</dd></div><div><dt>Test amount for full delivery</dt><dd>{xrplAmount(order.totalCents, state.xrpl?.dropsPerZarCent)}</dd></div></> : <><div><dt>Funds held</dt><dd>{testnet ? `${((order.fundedCents - order.releasedCents - order.refundedCents) / 100).toFixed(2)} test tokens` : money(order.fundedCents - order.releasedCents - order.refundedCents, order.currency)}</dd></div><div><dt>Released</dt><dd>{testnet ? `${(order.releasedCents / 100).toFixed(2)} test tokens` : money(order.releasedCents, order.currency)}</dd></div></>}{order.refundedQuantity ? <div><dt>Refunded quantity</dt><dd>{number(order.refundedQuantity)} {order.unit}</dd></div> : null}{order.packSize ? <div><dt>Pack size</dt><dd>{order.packSize} per pack</dd></div> : null}</dl>
      {order.specification && <div className="subcard"><h3>Accepted specification</h3><p>{order.specification}</p></div>}
      {dispute && <div className="notice notice-warn"><AlertTriangle size={17} /><div><strong>Dispute open · {money(dispute.amountCents)} of quoted value</strong><p>{dispute.reason}</p></div></div>}
      {order.activeAuthorization && <div className="notice"><QrCode size={17} /><div><strong>{order.activeAuthorization.quantity} {order.unit} authorised</strong><p>{testnet ? "The supplier can accept with its linked wallet before the QR expires." : "The supplier or authorised driver can accept the handover before the QR expires."}</p></div></div>}
      <div className="button-row">
        {canPay && order.status === "approval" && <button type="button" className="primary" disabled={!!busy} onClick={() => void run("approveOrder", { orderId: order.id }, "Purchase approved.")}><ClipboardCheck size={16} />Approve purchase</button>}
        {canPay && order.status === "awaiting_funding" && (canSettle || canEnableXrpl ? <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("fund")}><Wallet size={16} />{canEnableXrpl ? "Choose payment method" : testnet ? "Review payment" : "Reserve demo funds"}</button> : <div className="notice notice-warn"><Wallet size={16} />Testnet funding is unavailable for this company.</div>)}
        {canPay && ["approval", "awaiting_funding"].includes(order.status) && !order.transactions.some((item) => item.status === "pending") && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("cancel")}>Cancel order</button>}
        {sales && order.status === "funded" && <button type="button" className="primary" disabled={!!busy} onClick={() => void run("dispatchOrder", { orderId: order.id }, "Order marked dispatched.")}><Truck size={16} />Dispatch goods</button>}
        {sales && !testnet && ["funded", "dispatched", "partial"].includes(order.status) && driverList.length > 0 && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("driver")}><Truck size={16} />{order.driverId ? "Change driver" : "Assign driver"}</button>}
        {canInspect && !order.activeAuthorization && outstanding > 0 && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("accept")}><QrCode size={16} />Inspect goods & generate QR</button>}
        {canInspect && activeAuthorization && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("accept")}><QrCode size={16} />Reopen handover QR</button>}
        {canInspect && activeAuthorization && testnet && <RevokeTestnetDelivery state={state} order={order} run={run} busy={busy} />}
        {canInspect && order.activeAuthorization && !testnet && <button type="button" className="secondary" disabled={!!busy} onClick={() => void run("cancelDelivery", { orderId: order.id }, "Handover authorisation cancelled.")}><RotateCw size={16} />Cancel current QR</button>}
        {!buyer && (sales || state.actor?.id === order.driverId) && ["dispatched", "partial"].includes(order.status) && <button type="button" className="primary" onClick={() => navigate("deliveries", "scan")}><QrCode size={16} />Scan handover QR</button>}
        {purchasing && order.status === "completed" && !order.reviewId && <button type="button" className="primary" disabled={!!busy} onClick={() => setDialog("review")}><Star size={16} />Leave review</button>}
        {purchasing && order.status === "completed" && <button type="button" className="secondary" disabled={!!busy} onClick={() => void reorder()}><RotateCw size={16} />Buy again</button>}
        {(purchasing || canPay || sales) && ["dispatched", "partial"].includes(order.status) && !dispute && <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog("dispute")}><AlertTriangle size={16} />Report an issue</button>}
        <button type="button" className="secondary" onClick={() => receipt(order)}><Download size={16} />Order summary</button>
      </div>
    </section>
    <XrplActivity state={state} order={order} busy={busy} run={run} />
    {order.transactions.length > 0 && <section className="card panel"><PanelTitle title="Payment activity" subtitle="Track settlement status and download confirmed records." /><TransactionList order={order} /></section>}
    <section className="card panel stack"><PanelTitle title="Order conversation" />
      {order.messages.length ? <div className="small-stack">{order.messages.map((item) => <div key={item.id} className="subcard"><div className="split-line"><h3>{item.author}</h3><time className="small-note" dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><p>{item.body}</p></div>)}</div> : <p className="small-note">No messages yet.</p>}
      {(buyer || supplier || state.actor?.id === order.driverId) && <form className="small-stack" onSubmit={(event) => void post(event)}><label className="field">Message<textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} maxLength={2000} required placeholder="Ask about delivery or share an order update" /></label><div><button className="secondary" type="submit" disabled={!!busy || !message.trim()}><Send size={15} />Send message</button></div></form>}
    </section>
    <OrderAttachments orderId={order.id} canUpload={buyer || supplier || state.actor?.id === order.driverId} />
    <section className="card panel"><PanelTitle title="Order timeline" /><ul className="timeline">{order.timeline.toReversed().map((item, index) => <li key={`${item.at}-${index}`}><Check size={14} /><span>{item.title}</span><time dateTime={item.at}>{dateLabel(item.at)}</time></li>)}</ul></section>
    {dialog === "fund" && <FundingDialog state={state} order={order} busy={busy} run={run} navigate={navigate} onClose={() => setDialog(null)} />}
    {dialog === "cancel" && <Dialog title="Cancel this order?" onClose={() => setDialog(null)}><div className="stack"><p className="notice notice-warn"><AlertTriangle size={17} />This cancels {order.reference} and returns reserved stock to the supplier.</p><div><button type="button" className="danger" disabled={!!busy} onClick={async () => { if (await run("cancelOrder", { orderId: order.id }, "Order cancelled and stock reservation released.")) setDialog(null); }}>Confirm cancellation</button></div></div></Dialog>}
    {dialog === "accept" && <AcceptanceForm state={state} order={order} busy={busy} run={run} onClose={() => setDialog(null)} onAuthorized={(data) => { setDialog(null); setAuthorization(data); }} />}
    {dialog === "review" && <OrderForm dialog="review" order={order} busy={busy} run={run} onClose={() => setDialog(null)} />}
    {dialog === "dispute" && <OrderForm dialog="dispute" order={order} busy={busy} run={run} onClose={() => setDialog(null)} />}
    {dialog === "driver" && <OrderForm dialog="driver" order={order} busy={busy} run={run} drivers={driverList} onClose={() => setDialog(null)} />}
    {authorization && <QrDialog authorization={authorization} mode={xrpl ? "xrpl" : testnet ? "testnet" : "demo"} currency={order.currency} dropsPerCent={state.xrpl?.dropsPerZarCent} tokenSymbol={state.escrow.mode === "testnet" ? state.escrow.tokenSymbol : undefined} onClose={() => setAuthorization(null)} />}
  </div>;
}

function FundingDialog({ state, order, busy, run, navigate, onClose }: Pick<OrderProps, "state" | "order" | "busy" | "run" | "navigate"> & { onClose: () => void }) {
  const mode = state.escrow;
  const testnet = mode.mode === "testnet";
  const canUseEscrow = testnet || (mode.mode === "demo" && state.actor?.demoRole);
  const canChoose = isXrplAvailable(state, order);
  const currency = order.currency ?? "ZAR";
  const goodsSubtotal = order.totalCents - order.taxCents - order.deliveryFeeCents;
  const pendingFunding = order.transactions.find((transaction) => transaction.kind === "funding" && transaction.status === "pending");

  async function fundDemo() {
    if (await run("fundOrder", { orderId: order.id }, "Demo funds reserved.")) onClose();
  }

  return <Dialog title={canChoose ? "Choose payment method" : "Review escrow payment"} onClose={onClose}>
    <div className="stack">
      {canUseEscrow && <div className="payment-checkout-total">
        <div><span>Reserve in escrow</span><strong>{paymentAmount(order.totalCents, testnet ? "testnet" : "demo", testnet ? mode.tokenSymbol : undefined, currency)}</strong></div>
        <LockKeyhole aria-hidden="true" size={24} />
      </div>}
      <div className="payment-checkout-order">
        <span className="payment-transaction-icon"><PackageCheck size={19} /></span>
        <div><strong>{order.product}</strong><span>{order.reference} · {companyName(state, order.supplierId)}</span></div>
      </div>
      <dl className="payment-breakdown">
        <div><dt>Goods · {number(order.quantity)} {order.unit}</dt><dd>{money(goodsSubtotal, currency)}</dd></div>
        <div><dt>Delivery</dt><dd>{money(order.deliveryFeeCents, currency)}</dd></div>
        <div><dt>Tax</dt><dd>{money(order.taxCents, currency)}</dd></div>
        <div><dt>Quoted total</dt><dd>{money(order.totalCents, currency)}</dd></div>
      </dl>
      {canUseEscrow && <><div className="payment-checkout-method">
        <ShieldCheck size={19} />
        <div><strong>{testnet ? `${mode.networkName} · ${mode.tokenSymbol}` : "Simulated payment"}</strong><p>Funds are reserved for {companyName(state, order.supplierId)} and released after a confirmed handover.</p></div>
      </div>
      {testnet ? <OrderFunding state={state} order={order} busy={busy} run={run} knownHash={pendingFunding?.hash} onFunded={onClose} /> :
        <button type="button" className="primary payment-confirm" disabled={!!busy} onClick={() => void fundDemo()}><LockKeyhole size={16} />Confirm demo reserve</button>}</>}
      <XrplCheckout state={state} order={order} busy={busy} run={run} navigate={navigate} onDone={onClose} />
    </div>
  </Dialog>;
}

function AcceptanceForm({ state, order, busy, run, onClose, onAuthorized }: { state: MarketplaceState; order: Order; busy: string; run: RunAction; onClose: () => void; onAuthorized: (authorization: DeliveryAuthorization) => void }) {
  const settled = order.acceptedQuantity + (order.refundedQuantity ?? 0);
  const remaining = order.quantity - settled;
  const [existingQuantity] = useState(order.activeAuthorization?.quantity);
  const [quantity, setQuantity] = useState(existingQuantity ?? remaining);
  const xrpl = order.paymentMode === "xrpl";
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
    <div className="payment-checkout-total"><div><span>{xrpl ? "XRPL Testnet autopay" : testnet ? "Testnet release" : "Demo release"}</span><strong>{xrpl ? xrplAmount(amount, state.xrpl?.dropsPerZarCent) : paymentAmount(amount, testnet ? "testnet" : "demo", state.escrow.mode === "testnet" ? state.escrow.tokenSymbol : undefined, order.currency)}</strong></div><QrCode size={24} /></div>
    <div className="payment-checkout-method"><LockKeyhole size={17} /><p>{xrpl ? "After the supplier or assigned driver confirms this QR, the owner’s mandate determines if a Testnet payment is sent." : testnet ? "The supplier accepts the single-use QR with its linked wallet." : "The supplier or authorised driver confirms the release with the single-use QR."}</p></div>
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
  return <ul className="payment-order-activity">
    {order.transactions.toReversed().map((transaction) => {
      const kind = transactionKinds[transaction.kind];
      return <li key={transaction.id}>
        <div className="payment-order-transaction">
          <span className="payment-transaction-icon"><kind.icon size={17} /></span>
          <div className="payment-row-title"><strong>{kind.label}</strong><span>{dateLabel(transaction.createdAt)} · {transaction.mode === "demo" ? "Demo" : "Testnet"}</span></div>
          <Tag value={transaction.status} />
          <strong className="payment-row-amount">{paymentAmount(transaction.amountCents, transaction.mode, undefined, order.currency)}</strong>
          {transaction.status === "confirmed" && <button type="button" className="secondary payment-receipt" onClick={() => receipt(order, transaction)}><FileText size={15} />Receipt</button>}
        </div>
        {transaction.hash && <p className="payment-transaction-hash">{transaction.hash}</p>}
      </li>;
    })}
  </ul>;
}

export function Funds({ state, navigate, busy, run }: Pick<OrderProps, "state" | "navigate" | "busy" | "run">) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderTransaction["kind"] | "all">("all");
  const [fundingId, setFundingId] = useState<string | null>(null);
  const mode = state.escrow;
  const testnet = mode.mode === "testnet";
  const format = (value: number) => testnet ? paymentAmount(value, "testnet", mode.tokenSymbol) : money(value);
  const balances = state.orders.filter((order) => (order.paymentMode ?? "demo") === mode.mode);
  const { funded, released, refunded } = balances.reduce((totals, order) => ({
    funded: totals.funded + order.fundedCents, released: totals.released + order.releasedCents, refunded: totals.refunded + order.refundedCents,
  }), { funded: 0, released: 0, refunded: 0 });
  const held = Math.max(0, funded - released - refunded);
  const records = state.orders.flatMap((order) => order.transactions.map((transaction) => ({ order, transaction })))
    .sort((first, second) => second.transaction.createdAt.localeCompare(first.transaction.createdAt));
  const needle = query.trim().toLowerCase();
  const visible = records.filter(({ order, transaction }) => (filter === "all" || transaction.kind === filter) &&
    [order.reference, order.product, companyName(state, order.supplierId), companyName(state, order.buyerId),
      transactionKinds[transaction.kind].label, transaction.status, transaction.hash]
      .some((value) => value?.toLowerCase().includes(needle)));
  const canFund = state.actor && ["owner", "approver"].includes(state.actor.role) && (testnet || (mode.mode === "demo" && state.actor.demoRole));
  const payable = state.orders.filter((order) => isXrplAvailable(state, order) || (canFund && order.buyerId === state.actor?.companyId && order.status === "awaiting_funding"));
  const checkout = payable.find((order) => order.id === fundingId);
  const filters = ["all", "funding", "release", "refund"] as const;

  function exportCsv() {
    download("stockpact-transactions.csv", csv([
      ["Order", "Type", "Mode", "Status", "Nominal cents", "Quantity", "Transaction hash", "Created"],
      ...visible.map(({ order, transaction }) => [order.reference, transaction.kind, transaction.mode, transaction.status,
        transaction.amountCents, transaction.quantity, transaction.hash, transaction.createdAt]),
    ]), "text/csv;charset=utf-8");
  }

  return <>
    <ViewTitle title="Payments" subtitle="Fund orders, track supplier payouts and find receipts." />
    <div className="payments-page">
      {mode.mode === "disabled" ? <p className="notice notice-warn"><Wallet size={16} />Testnet funding is unavailable for this company.</p> : <section className="payment-overview" aria-label="Escrow overview">
        <div className="payment-balance">
          <div className="payment-balance-header"><span><LockKeyhole size={17} /> In escrow</span><span className="payment-mode">{testnet ? mode.networkName : "Demo payments"}</span></div>
          <strong className="payment-balance-number">{format(held)}</strong>
          <p>{testnet ? "Testnet funds held for open orders" : "Simulated rand reserved for open orders"}</p>
          <div className="payment-balance-track" aria-hidden="true">
            {funded > 0 && <><span style={{ flexGrow: held }} /><span style={{ flexGrow: released }} /><span style={{ flexGrow: refunded }} /></>}
          </div>
        </div>
        <dl className="payment-totals">
          <div><dt><ArrowDownToLine size={17} /> Total funded</dt><dd>{format(funded)}</dd></div>
          <div><dt><ArrowUpRight size={17} /> Released</dt><dd>{format(released)}</dd></div>
          <div><dt><ArrowDownLeft size={17} /> Refunded</dt><dd>{format(refunded)}</dd></div>
        </dl>
      </section>}
      {payable.length > 0 && <section className="card payment-due">
        <PanelTitle title="Awaiting payment" subtitle="Choose how to settle your approved orders." />
        {payable.map((order) => <div className="payment-due-row" key={order.id}>
          <span className="payment-transaction-icon"><PackageCheck size={18} /></span>
          <div className="payment-row-title"><strong>{order.product}</strong><span>{order.reference} · {companyName(state, order.supplierId)}</span></div>
          <strong className="payment-row-amount">{format(order.totalCents)}</strong>
          <button type="button" className="primary" disabled={!!busy} onClick={() => setFundingId(order.id)}>Review payment <ArrowRight size={15} /></button>
        </div>)}
      </section>}
      <XrplActivity state={state} navigate={navigate} busy={busy} run={run} />
      <section className="card payment-ledger">
        <div className="payment-ledger-toolbar">
          <PanelTitle title="Transaction history" />
          <button className="secondary" type="button" disabled={!visible.length} onClick={exportCsv}><Download size={16} />Export CSV</button>
        </div>
        {records.length > 0 && <div className="payment-ledger-filters">
          <div className="filters" role="group" aria-label="Transaction type">{filters.map((kind) => <button type="button" className="filter" aria-pressed={filter === kind} key={kind} onClick={() => setFilter(kind)}>{kind === "all" ? "All activity" : transactionKinds[kind].filter}</button>)}</div>
          <label className="search-field"><Search size={15} /><span className="sr-only">Search transactions</span><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search transactions" /></label>
        </div>}
        {visible.length ? <ul className="payment-ledger-list" aria-label="Transactions">{visible.map(({ order, transaction }) => {
          const kind = transactionKinds[transaction.kind];
          return <li className="payment-ledger-row" key={`${order.id}:${transaction.id}`}>
            <span className="payment-transaction-icon"><kind.icon size={18} /></span>
            <div className="payment-row-title"><strong>{kind.label}</strong><span>{order.product} · {order.reference}</span></div>
            <div className="payment-row-meta"><time dateTime={transaction.createdAt}>{dateLabel(transaction.createdAt)}</time><span>{transaction.mode === "demo" ? "Demo" : "Testnet"}</span></div>
            <Tag value={transaction.status} />
            <strong className="payment-row-amount">{paymentAmount(transaction.amountCents, transaction.mode, undefined, order.currency)}</strong>
            <div className="payment-row-actions">
              {transaction.status === "confirmed" && <button type="button" className="icon-button" aria-label={`Download ${kind.label.toLowerCase()} receipt for ${order.reference}`} title="Download receipt" onClick={() => receipt(order, transaction)}><Download size={16} /></button>}
              <button type="button" className="icon-button" aria-label={`Open order ${order.reference}`} title="Open order" onClick={() => navigate("orders", order.id)}><ArrowUpRight size={16} /></button>
            </div>
          </li>;
        })}</ul> : <Empty title={records.length ? "No matching transactions" : "No transactions yet"} detail={records.length ? "Try a different search or transaction type." : "Funding, releases and refunds will appear here."} icon={Wallet} />}
      </section>
    </div>
    {checkout && <FundingDialog state={state} order={checkout} busy={busy} run={run} navigate={navigate} onClose={() => setFundingId(null)} />}
  </>;
}
