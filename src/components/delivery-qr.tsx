"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Clipboard, Clock, Copy, LockKeyhole, QrCode, ScanLine, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import type { DeliveryAuthorization, MarketplaceState } from "../shared/marketplace";
import { RedeemTestnetDelivery } from "../integrations/escrow/controls";
import { type Navigate, type RunAction } from "./client";
import { Busy, Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money } from "./ui";

export function QrDialog({ authorization, mode, currency, tokenSymbol, onClose }: { authorization: DeliveryAuthorization; mode: "demo" | "testnet"; currency?: string; tokenSymbol?: string; onClose: () => void }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const url = `${window.location.origin}${window.location.pathname}#deliveries/scan/${encodeURIComponent(authorization.token)}`;
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(authorization.expiresAt) - clock) / 1000));
  const expired = secondsLeft === 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const amount = mode === "demo" ? money(authorization.amountCents, currency) : `${(authorization.amountCents / 100).toFixed(2)} ${tokenSymbol ?? "test tokens"}`;

  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 288, margin: 4, color: { dark: "#211b17", light: "#ffffff" }, errorCorrectionLevel: "M" }).then((source) => { if (active) setImage(source); }).catch(() => { if (active) setError("QR could not render. Share the handover link below."); });
    return () => { active = false; };
  }, [url]);

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("Select and copy the link from the field below."); }
  }

  return <Dialog title="Delivery handover QR" onClose={onClose}>
    <div className="payment-qr">
      <div className="payment-qr-ticket">
        <span className="payment-mode">{mode === "demo" ? "Demo release" : "Testnet release"}</span>
        <strong>{amount}</strong>
        <p>{authorization.quantity} accepted</p>
        {expired ? <p role="status">This handover QR has expired.</p> : <>
          {image ? <Image src={image} width={288} height={288} unoptimized alt="Scan to review the authorized delivery handover" /> : !error && <Busy label="Preparing QR code" />}
          <span className="payment-qr-expiry"><Clock size={14} /> Expires in {countdown} · Single use</span>
        </>}
      </div>
      {!expired && <>
        <p className="small-note">{mode === "testnet" ? "The supplier reviews and accepts with its linked wallet." : "The signed-in supplier or assigned driver reviews and accepts the release."}</p>
        <label className="field qr-link">Handover link<input value={url} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
        <button type="button" className="secondary" onClick={() => void copy()}><Copy size={16} />{copied ? "Link copied" : "Copy handover link"}</button>
        {error && <p role="status" className="notice notice-warn">{error}</p>}
      </>}
    </div>
  </Dialog>;
}

function handoverToken(input: string) {
  const trimmed = input.trim();
  if (trimmed.includes("#deliveries/scan/")) {
    const value = trimmed.split("#deliveries/scan/")[1];
    try { return decodeURIComponent(value); } catch { return ""; }
  }
  return /^[\w.=-]{10,256}$/.test(trimmed) ? trimmed : "";
}

function CameraScanner({ onScan }: { onScan: (value: string) => void }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const onRead = useRef(onScan);
  useEffect(() => { onRead.current = onScan; }, [onScan]);
  useEffect(() => {
    if (!active) return;
    let closed = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    async function scan() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access needs a secure connection. Paste the QR link instead.");
        const decode = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 720 } } });
        if (closed || !video.current) { stream.getTracks().forEach((track) => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Camera decoding is unavailable. Paste the QR link instead.");
        const read = () => {
          const player = video.current;
          if (closed || !player) return;
          if (player.videoWidth && player.videoHeight && player.readyState >= 2) {
            canvas.width = player.videoWidth;
            canvas.height = player.videoHeight;
            context.drawImage(player, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const qr = decode(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
            if (qr?.data && handoverToken(qr.data)) {
              onRead.current(qr.data);
              setActive(false);
              return;
            }
          }
          timer = window.setTimeout(read, 160);
        };
        read();
      } catch (caught) {
        if (closed) return;
        setError(caught instanceof Error && caught.name !== "NotAllowedError" ? caught.message : "Allow camera access or paste the QR link.");
        setActive(false);
      }
    }
    void scan();
    return () => { closed = true; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, [active]);
  return <div className="small-stack">
    <div className="payment-scan-camera">
      {active ? <video ref={video} className="scan-video" autoPlay muted playsInline aria-label="Camera preview for QR scanning" /> : <ScanLine size={28} aria-hidden="true" />}
      <button className="secondary" type="button" onClick={() => { setError(""); setActive((previous) => !previous); }}><Camera size={16} />{active ? "Stop camera" : "Scan with camera"}</button>
    </div>
    {error && <p role="status" className="notice notice-warn">{error}</p>}
  </div>;
}

function Redeem({ initial, state, busy, run, navigate }: { initial: string; state: MarketplaceState; busy: string; run: RunAction; navigate: Navigate }) {
  const [input, setInput] = useState(initial);
  const [authorization, setAuthorization] = useState<DeliveryAuthorization | null>(null);
  const [error, setError] = useState("");
  const [simulateInterruption, setSimulateInterruption] = useState(false);

  async function inspect(value: string) {
    setError("");
    setAuthorization(null);
    const token = handoverToken(value);
    if (!token) { setError("Paste a StockPact handover link or its authorisation code."); return; }
    const result = await run<DeliveryAuthorization>("inspectDelivery", { token });
    if (result?.data) setAuthorization({ ...result.data, token });
  }

  function submit(event: FormEvent) { event.preventDefault(); void inspect(input); }

  async function redeem() {
    if (!authorization) return;
    const result = await run("redeemDelivery", { token: authorization.token, simulateInterruption }, "Handover accepted. Demo payment recorded.");
    setSimulateInterruption(false);
    if (!result) return;
    setInput("");
    setAuthorization(null);
    navigate("orders", authorization.orderId);
  }

  const order = state.orders.find((item) => item.id === authorization?.orderId);
  const testnet = (order?.paymentMode ?? state.escrow.mode) === "testnet";

  return <section className="card panel stack payment-scan-panel">
    <PanelTitle title="Review a handover" subtitle="Scan the buyer’s QR or paste the link. A review is required before accepting payment." />
    <CameraScanner onScan={(value) => { setInput(value); void inspect(value); }} />
    <form className="small-stack" onSubmit={submit}><label className="field">Handover link or code<input value={input} onChange={(event) => { setInput(event.currentTarget.value); setAuthorization(null); }} autoCapitalize="none" autoCorrect="off" maxLength={800} required placeholder="Paste a link or authorisation code" /></label><div><button type="submit" className="primary" disabled={!!busy}><Clipboard size={16} />Review handover</button></div></form>
    {busy === "inspectDelivery" && <Busy label="Checking handover authorisation" />}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {authorization && <article className="subcard stack"><div className="split-line"><h3>Handover authorisation</h3><Tag value={authorization.status} /></div>
      <div className="payment-checkout-total"><div><span>{testnet ? "Testnet release" : "Demo release"}</span><strong>{testnet ? `${(authorization.amountCents / 100).toFixed(2)} ${state.escrow.mode === "testnet" ? state.escrow.tokenSymbol : "test tokens"}` : money(authorization.amountCents, order?.currency)}</strong></div><LockKeyhole size={24} /></div>
      <dl className="payment-breakdown"><div><dt>Accepted quantity</dt><dd>{authorization.quantity}{order?.unit ? ` ${order.unit}` : ""}</dd></div>{order && <div><dt>Order</dt><dd>{order.reference}</dd></div>}</dl>
      {testnet && <RedeemTestnetDelivery state={state} inspection={authorization} token={authorization.token} run={run} busy={busy} onRedeemed={() => navigate("orders", authorization.orderId)} />}
      {authorization.status === "active" && !testnet && <><label className="check"><input type="checkbox" checked={simulateInterruption} onChange={(event) => setSimulateInterruption(event.currentTarget.checked)} />Simulate a payment interruption</label><button className="primary" type="button" disabled={!!busy} onClick={() => void redeem()}><ShieldCheck size={16} />Accept handover and record demo payment</button></>}
    </article>}
  </section>;
}

export function Deliveries({ state, selected, busy, run, navigate }: { state: MarketplaceState; selected: string; busy: string; run: RunAction; navigate: Navigate }) {
  const scanning = selected === "scan" || selected.startsWith("scan/");
  const initial = selected.startsWith("scan/") ? selected.slice("scan/".length) : "";
  const deliveryOrders = state.orders.filter((order) => ["funded", "dispatched", "partial", "completed", "disputed"].includes(order.status));
  return <>
    <ViewTitle title="Deliveries" subtitle="Track dispatch, inspect goods and confirm a handover." action={<button type="button" className="primary" onClick={() => navigate("deliveries", scanning ? "" : "scan")}>{scanning ? <Truck size={16} /> : <ScanLine size={16} />}{scanning ? "View deliveries" : "Scan delivery QR"}</button>} />
    {scanning ? <Redeem key={initial} initial={initial} state={state} busy={busy} run={run} navigate={navigate} /> : <section className="card panel small-stack"><PanelTitle title="Delivery orders" />{deliveryOrders.map((order) => <button type="button" className="list-button" key={order.id} onClick={() => navigate("orders", order.id)}><span className="icon-tile amber"><Truck size={17} /></span><div><strong>{order.product}</strong><small>{order.reference} · {dateLabel(order.deliveryDate)} · {order.acceptedQuantity}/{order.quantity} accepted</small></div><Tag value={order.status} /></button>)}{!deliveryOrders.length && <Empty title="No deliveries yet" detail="Funded and dispatched orders will appear here." icon={QrCode} />}</section>}
  </>;
}
