"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import type { PurchaseRequest, RequestDraft } from "../shared/marketplace";
import { cents, type Navigate, type RunAction } from "./client";

const maxLines = 12;
type ProductLine = Pick<RequestDraft, "product" | "quantity" | "unit" | "packSize" | "notes" | "category" | "substitutions" | "budgetCents" | "shareBudget">;
type EditableLine = ProductLine & { key: number };

const emptyLine = (key: number): EditableLine => ({ key, product: "", quantity: 1, unit: "units", notes: "", category: "", substitutions: false, budgetCents: null });

export function MultiPurchaseForm({ initial, location, busy, run, navigate, onSaved }: {
  initial: RequestDraft | null;
  location?: string;
  busy: string;
  run: RunAction;
  navigate: Navigate;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [deliveryArea, setDeliveryArea] = useState(initial?.location ?? (location || "Cape Town"));
  const [requiredDate, setRequiredDate] = useState(initial?.requiredDate ?? "");
  const [collection, setCollection] = useState(initial?.collection ?? false);
  const [lines, setLines] = useState<EditableLine[]>(() => [initial ? { ...initial, key: 0 } : emptyLine(0), emptyLine(1)]);
  const nextKey = useRef(2);
  const submission = useRef<{ fingerprint: string; groupId: string } | null>(null);
  const searching = busy === "createMultiRequest";

  function changeLine<K extends keyof ProductLine>(key: number, name: K, value: ProductLine[K]) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [name]: value } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const drafts: RequestDraft[] = lines.map((line) => ({ product: line.product.trim(), quantity: line.quantity, unit: line.unit.trim(),
      packSize: line.packSize, notes: line.notes, category: line.category, substitutions: line.substitutions,
      budgetCents: line.budgetCents, shareBudget: line.shareBudget, mode: "manual", location: deliveryArea.trim(), requiredDate, collection }));
    const values = { label: label.trim() || undefined, drafts };
    const fingerprint = JSON.stringify(values);
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, groupId: crypto.randomUUID() };
    const result = await run<{ groupId: string; requests: PurchaseRequest[] }>("createMultiRequest", { ...values, groupId: submission.current.groupId });
    const first = result?.data?.requests[0];
    if (first) {
      onSaved();
      navigate("requests", first.id);
    }
  }

  return <form className="stack" onSubmit={(event) => void submit(event)}>
    <p className="small-note">Add up to {maxLines} products. Each product gets its own supplier quotes, order and handover.</p>
    <div className="form-grid">
      <label className="field full">Purchase name <small>Optional</small><input value={label} maxLength={100} placeholder="Weekly shop restock" onChange={(event) => setLabel(event.currentTarget.value)} /></label>
      <label className="field">Fulfilment<select value={collection ? "collection" : "delivery"} onChange={(event) => setCollection(event.currentTarget.value === "collection")}><option value="delivery">Delivery</option><option value="collection">Collection</option></select></label>
      <label className="field">Required by<input type="date" value={requiredDate} required onChange={(event) => setRequiredDate(event.currentTarget.value)} /></label>
      <label className="field full">{collection ? "Collection area" : "Delivery area"}<input value={deliveryArea} required={!collection} maxLength={220} onChange={(event) => setDeliveryArea(event.currentTarget.value)} /></label>
    </div>
    {lines.map((line, index) => <fieldset className="subcard small-stack" key={line.key}>
      <legend>Product {index + 1}</legend>
      <div className="form-grid">
        <label className="field full">Product and specification<input value={line.product} required minLength={2} maxLength={180} onChange={(event) => changeLine(line.key, "product", event.currentTarget.value)} /></label>
        <label className="field">Quantity<input type="number" value={line.quantity || ""} min={1} max={100000} required onChange={(event) => changeLine(line.key, "quantity", Number(event.currentTarget.value))} /></label>
        <label className="field">Unit<input value={line.unit} maxLength={40} required onChange={(event) => changeLine(line.key, "unit", event.currentTarget.value)} /></label>
      </div>
      <details>
        <summary>Product details</summary>
        <div className="form-grid">
          <label className="field">Units per pack<input type="number" value={line.packSize ?? ""} min={1} max={100000} onChange={(event) => changeLine(line.key, "packSize", event.currentTarget.value ? Number(event.currentTarget.value) : undefined)} /></label>
          <label className="field">Category<input value={line.category} maxLength={90} onChange={(event) => changeLine(line.key, "category", event.currentTarget.value)} /></label>
          <label className="field full">Additional requirements<textarea value={line.notes} maxLength={1500} onChange={(event) => changeLine(line.key, "notes", event.currentTarget.value)} /></label>
          <label className="field full">Budget in rand<input type="number" min={0} max={1000000} step="0.01" value={line.budgetCents === null ? "" : line.budgetCents / 100} onChange={(event) => changeLine(line.key, "budgetCents", event.currentTarget.value ? cents(event.currentTarget.value) : null)} /></label>
          <label className="check full"><input type="checkbox" checked={!!line.shareBudget} onChange={(event) => changeLine(line.key, "shareBudget", event.currentTarget.checked)} />Share this product budget with suppliers</label>
          <label className="check full"><input type="checkbox" checked={line.substitutions} onChange={(event) => changeLine(line.key, "substitutions", event.currentTarget.checked)} />Allow substitutions</label>
        </div>
      </details>
      {lines.length > 2 && <div><button className="secondary" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={!!busy}><Trash2 size={15} />Remove product {index + 1}</button></div>}
    </fieldset>)}
    <div className="button-row">
      <button className="secondary" type="button" disabled={lines.length >= maxLines || !!busy} onClick={() => { const line = emptyLine(nextKey.current++); setLines((current) => [...current, line]); }}><Plus size={16} />Add product</button>
      <button className="primary" type="submit" disabled={!!busy}>{searching ? <><LoaderCircle className="spin" size={16} />Finding suppliers…</> : <><Search size={16} />Find suppliers for all products</>}</button>
    </div>
  </form>;
}
