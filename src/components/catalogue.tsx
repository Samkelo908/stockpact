"use client";

import Image from "next/image";
import { createElement, useState, type FormEvent } from "react";
import { ArrowRight, Boxes, ClipboardList, Coffee, Download, Droplets, Heart, MapPin, Package, Plus, Search, ShoppingBag, Star, Store, Upload } from "lucide-react";
import type { Listing, MarketplaceState, RequestDraft } from "../shared/marketplace";
import { BuiltInPhoto } from "./built-in-photo";
import { cents, companyOf, csv, download, type Navigate, type RunAction } from "./client";
import { freshDraft } from "./purchasing";
import { Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, number } from "./ui";

type CatalogueProps = { state: MarketplaceState; busy: string; run: RunAction; navigate: Navigate; selected: string };

const cataloguePhotos: Record<string, string> = {
  "demo-tomatoes-a": "/listing-tomatoes.webp",
  "demo-tomatoes-b": "/listing-tomatoes.webp",
  "demo-water-a": "/listing-water.webp",
  "demo-water-b": "/listing-water.webp",
  "demo-oil": "/listing-oil.webp",
  "demo-coffee": "/listing-coffee.webp",
  "demo-boxes": "/listing-packaging.webp",
};

function catalogueIcon(category: string) {
  if (/beverage/i.test(category)) return Droplets;
  if (/packaging|office/i.test(category)) return Boxes;
  if (/food/i.test(category)) return Coffee;
  return ShoppingBag;
}

function CataloguePhoto({ listing }: { listing: Listing }) {
  const [failedSource, setFailedSource] = useState<string>();
  const uploaded = listing.image?.startsWith("/api/listing-photo?") ? listing.image : undefined;
  const builtIn = listing.demo ? cataloguePhotos[listing.id] : undefined;
  const fallback = createElement(catalogueIcon(listing.category), { size: 40, strokeWidth: 1.4, "aria-hidden": true });
  if (uploaded && failedSource !== uploaded) return <Image src={uploaded} alt="" fill unoptimized onError={() => setFailedSource(uploaded)} />;
  return builtIn ? <BuiltInPhoto key={builtIn} src={builtIn} alt="" fallback={fallback} /> : fallback;
}

const singularUnits: Record<string, string> = { cases: "case", boxes: "box", bottles: "bottle", bags: "bag", packs: "pack", units: "unit" };

function priceUnit(unit: string) {
  const key = unit.toLowerCase();
  return Object.hasOwn(singularUnits, key) ? singularUnits[key] : unit;
}

export function Marketplace({ state, busy, run, query, setQuery, startDraft }: CatalogueProps & { query: string; setQuery: (query: string) => void; startDraft: (draft: RequestDraft) => void }) {
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [sort, setSort] = useState("catalogue");
  const [saved, setSaved] = useState(false);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<string | null>(null);
  const companies = new Map(state.companies.map((company) => [company.id, company]));
  const active = state.listings.filter((listing) => !listing.archived).map((listing) => ({
    ...listing, supplier: companies.get(listing.supplierId),
  }));
  const categories = [...new Set(active.map((listing) => listing.category))].sort();
  const deliveryAreas = [...new Set(active.flatMap((listing) => listing.deliveryAreas))].sort();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listings = active.filter((listing) => {
    const searchable = [listing.name, listing.category, listing.description, listing.brand, listing.supplier?.name, listing.supplier?.location, ...listing.deliveryAreas].join(" ").toLowerCase();
    return (!category || category === listing.category) && (!area || listing.deliveryAreas.includes(area)) &&
      (!saved || state.favorites.includes(listing.id)) && terms.every((term) => searchable.includes(term));
  });
  if (sort !== "catalogue") {
    listings.sort((first, second) => {
      if (first.priceCents === null) return second.priceCents === null ? 0 : 1;
      if (second.priceCents === null) return -1;
      return sort === "price-low" ? first.priceCents - second.priceCents : second.priceCents - first.priceCents;
    });
  }
  const pages = Math.max(1, Math.ceil(listings.length / 6));
  const currentPage = Math.min(page, pages);
  const current = listings.slice((currentPage - 1) * 6, currentPage * 6);
  const selected = detail ? active.find((listing) => listing.id === detail) : undefined;
  const supplier = selected?.supplier;
  const supplierReviews = state.reviews.filter((review) => review.supplierId === supplier?.id);
  const own = selected?.supplierId === state.actor?.companyId;
  const buyer = companyOf(state, state.actor?.companyId);
  const canRequest = !own && buyer?.capabilities.includes("buyer") && ["owner", "purchaser"].includes(state.actor?.role ?? "");

  function requestListing(listing: Listing) {
    setDetail(null);
    startDraft({ ...freshDraft(buyer?.location || "Cape Town"), product: listing.name, category: listing.category, unit: listing.unit, quantity: listing.minimum, packSize: listing.packSize });
  }

  function resetFilters() {
    setCategory("");
    setArea("");
    setSaved(false);
    setSort("catalogue");
    setQuery("");
    setPage(1);
  }

  return <>
    <div className="market">
      <header className="market-heading">
        <div>
          <h1>Marketplace</h1>
          <p>Source stock from South African wholesalers.</p>
        </div>
        {buyer?.location && <span className="market-location"><MapPin size={17} aria-hidden="true" /><span><small>Your location</small>{buyer.location}</span></span>}
      </header>
      <section className="market-filters" aria-label="Marketplace filters">
        <div className="market-filter-bar">
          <label className="market-search"><span className="sr-only">Search listings</span><Search size={19} aria-hidden="true" /><input type="search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }} placeholder="Search stock, suppliers or suburbs" /></label>
          <label className="market-area"><MapPin size={17} aria-hidden="true" /><span className="sr-only">Delivery area</span><select value={area} onChange={(event) => { setArea(event.currentTarget.value); setPage(1); }}><option value="">All delivery areas</option>{deliveryAreas.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button type="button" className="market-saved" aria-pressed={saved} onClick={() => { setSaved((previous) => !previous); setPage(1); }}><Heart size={17} aria-hidden="true" />Favourites</button>
        </div>
        <div className="market-categories" role="group" aria-label="Product categories">
          <button type="button" aria-pressed={!category} onClick={() => { setCategory(""); setPage(1); }}>All products</button>
          {categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => { setCategory(item); setPage(1); }}>{item}</button>)}
        </div>
      </section>
      <div className="market-results">
        <p role="status">{number(listings.length)} {listings.length === 1 ? "listing" : "listings"}</p>
        <label><span>Sort by</span><select value={sort} onChange={(event) => { setSort(event.currentTarget.value); setPage(1); }}><option value="catalogue">Catalogue order</option><option value="price-low">Lowest listed price</option><option value="price-high">Highest listed price</option></select></label>
      </div>
      {!current.length ? <section className="card panel"><Empty title="No matching listings" detail="Try another product, supplier or delivery area." icon={Store} action={<button type="button" className="secondary" onClick={resetFilters}>Clear filters</button>} /></section> :
        <div className="market-grid">{current.map((listing) => {
          const favourite = state.favorites.includes(listing.id);
          return <article className="market-listing" key={listing.id}>
            <div className="market-photo">
              <CataloguePhoto listing={listing} />
              <button type="button" className="icon-button market-favourite" disabled={!!busy} aria-label={`${favourite ? "Remove from" : "Add to"} favourites: ${listing.name}`} aria-pressed={favourite} onClick={() => void run("toggleFavorite", { listingId: listing.id })}><Heart size={18} /></button>
            </div>
            <div className="market-product">
              <p className="market-category">{listing.category}</p>
              <h2>{listing.name}</h2>
              <p className="market-supplier">{listing.supplier?.name ?? "Supplier"}{listing.supplier?.location && <><span aria-hidden="true"> · </span>{listing.supplier.location.split(",")[0]}</>}</p>
              <div className="market-price"><strong>{listing.priceCents === null ? "Price on request" : money(listing.priceCents)}</strong>{listing.priceCents !== null && <span>/ {priceUnit(listing.unit)}</span>}</div>
              <p className="market-stock"><Package size={15} aria-hidden="true" />{number(listing.available)} {listing.unit} listed{listing.surplus && " · Surplus stock"}</p>
              <button className="market-detail" type="button" onClick={() => setDetail(listing.id)}>View listing<ArrowRight size={17} /></button>
            </div>
          </article>;
        })}</div>}
      {pages > 1 && <div className="market-pagination button-row" role="group" aria-label="Marketplace pages"><button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="small-note">Page {currentPage} of {pages}</span><button type="button" className="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
    </div>
    {selected && <Dialog title={selected.name} onClose={() => setDetail(null)}><div className="stack">
      <div className="subcard small-stack"><div className="split-line"><div><h3>{supplier?.name ?? "Supplier"}</h3><p>{supplier?.location} · {supplierReviews.length ? `${(supplierReviews.reduce((sum, review) => sum + review.rating, 0) / supplierReviews.length).toFixed(1)} / 5 (${supplierReviews.length})` : "No reviews yet"}</p></div>{supplier?.verification.business === "verified" && <Tag value={supplier.demo ? "Demo verified" : "Verified business"} variant="green" />}</div><p>{selected.description}</p>{selected.brand && <p>Brand {selected.brand}</p>}</div>
      <dl className="details-grid"><div><dt>Listed price</dt><dd>{selected.priceCents === null ? "Price on request" : money(selected.priceCents) + " / " + priceUnit(selected.unit)}</dd></div><div><dt>Listed stock</dt><dd>{number(selected.available)} {selected.unit}</dd></div><div><dt>Minimum order</dt><dd>{number(selected.minimum)} {selected.minimum === 1 ? priceUnit(selected.unit) : selected.unit}</dd></div><div><dt>Units per pack</dt><dd>{number(selected.packSize)}</dd></div><div><dt>Delivery areas</dt><dd>{selected.deliveryAreas.join(", ") || "Ask supplier"}</dd></div><div><dt>Collection</dt><dd>{selected.collection ? "Available" : "Unavailable"}</dd></div><div><dt>Listed lead time</dt><dd>{selected.leadDays} {selected.leadDays === 1 ? "day" : "days"}</dd></div><div><dt>Stock last updated</dt><dd>{dateLabel(selected.updatedAt)}</dd></div></dl>
      <p className="small-note">A supplier quote confirms current availability, delivery and pricing.</p>
      <div className="button-row">{canRequest && <button className="primary" type="button" onClick={() => requestListing(selected)}><ClipboardList size={16} />Request current pricing</button>}{supplier && !own && <button className="secondary" type="button" disabled={!!busy} onClick={() => void run("preferSupplier", { supplierId: supplier.id })}><Star size={16} />{state.preferredSuppliers.includes(supplier.id) ? "Remove preferred supplier" : "Prefer supplier"}</button>}</div>
    </div></Dialog>}
  </>;
}

type ListingInput = Omit<Listing, "id" | "supplierId" | "demo" | "updatedAt" | "image"> & { id?: string };
const columns = ["name", "category", "description", "unit", "price", "available", "minimum", "packSize", "deliveryAreas", "leadDays", "deliveryFee", "collection", "surplus", "brand"];
const sample = ["Paper cups", "Packaging", "Food-safe 250 ml cups", "cases", "230.00", "30", "1", "100", "Cape Town|Woodstock", "2", "60.00", "true", "false", ""];

function readRows(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let endedQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; endedQuote = true; }
      else field += character;
      continue;
    }
    if (character === "," || character === "\r" || character === "\n") {
      row.push(field); field = ""; endedQuote = false;
      if (character !== ",") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        rows.push(row); row = [];
      }
    } else if (character === '"' && !field && !endedQuote) quoted = true;
    else if (character === '"' || endedQuote) throw new Error(`Row ${rows.length + 1} contains an invalid quoted field.`);
    else field += character;
  }
  if (quoted) throw new Error(`Row ${rows.length + 1} has an unclosed quote.`);
  if (field || row.length || endedQuote) rows.push([...row, field]);
  return rows;
}

function validateCsv(text: string) {
  const [header, ...rows] = readRows(text);
  if (!header || columns.some((column, index) => header[index]?.trim() !== column) || header.length !== columns.length) throw new Error("CSV columns must match the template in order.");
  if (rows.length > 100) throw new Error("Import up to 100 listings per file.");
  const listings: ListingInput[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    if (row.every((cell) => !cell.trim())) return;
    const [name, category, description, unit, price, stock, min, pack, areas, lead, fee, collection, surplus, brand] = row.map((cell) => cell.trim());
    const integers = [[stock, 0, 1_000_000], [min, 1, 100_000], [pack, 1, 100_000], [lead, 0, 365]] as const;
    const decimal = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
    if (row.length !== columns.length || name.length < 2 || !category || !unit || integers.some(([value, low, high]) => !/^\d+$/.test(value) || Number(value) < low || Number(value) > high) || (price && !decimal.test(price)) || !decimal.test(fee) || !["true", "false"].includes(collection) || !["true", "false"].includes(surplus)) {
      errors.push(`Row ${index + 2}. Check required fields, quantities, rand values and true/false values.`);
      return;
    }
    listings.push({ name, category, description, unit, priceCents: price ? cents(price) : null, available: Number(stock), minimum: Number(min), packSize: Number(pack), deliveryAreas: areas.split("|").map((area) => area.trim()).filter(Boolean), leadDays: Number(lead), deliveryFeeCents: cents(fee), collection: collection === "true", surplus: surplus === "true", brand, archived: false });
  });
  return { listings, errors };
}

export function Inventory({ state, busy, run, navigate }: CatalogueProps) {
  const [edit, setEdit] = useState<Listing | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const company = companyOf(state, state.actor?.companyId);
  const listings = state.listings.filter((listing) => listing.supplierId === state.actor?.companyId && listing.archived === showArchived);
  const canEdit = company?.capabilities.includes("supplier") && ["owner", "sales"].includes(state.actor?.role ?? "");
  return <>
    <ViewTitle title="Inventory & listings" subtitle="Manage saleable stock, minimum orders and delivery terms." action={canEdit ? <div className="button-row"><button className="secondary" type="button" onClick={() => setImporting(true)}><Upload size={16} />Import CSV</button><button className="primary" type="button" onClick={() => setEdit("new")}><Plus size={16} />New listing</button></div> : undefined} />
    <section className="card panel stack"><PanelTitle title="Company stock" action={canEdit ? <button className="filter" type="button" aria-pressed={showArchived} onClick={() => setShowArchived((previous) => !previous)}>{showArchived ? "Show active" : "Show archived"}</button> : undefined} />
      {!listings.length && <Empty title={showArchived ? "No archived listings" : "No active listings"} detail={canEdit ? "Create a listing or import your stock from a CSV file." : "Enable the supplier capability in your company settings to sell stock."} icon={Package} action={!canEdit && state.actor?.role === "owner" ? <button type="button" className="secondary" onClick={() => navigate("settings")}>Company settings</button> : undefined} />}
      {listings.length > 0 && <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Available</th><th>Price</th><th>Updated</th>{canEdit && <th>Action</th>}</tr></thead><tbody>{listings.map((listing) => <tr key={listing.id}><td><strong>{listing.name}</strong><br /><span className="small-note">{listing.category}</span></td><td>{listing.available} {listing.unit}{listing.available <= listing.minimum && <><br /><Tag value="Low stock" variant="amber" /></>}</td><td>{listing.priceCents == null ? "Quote" : money(listing.priceCents)}</td><td>{dateLabel(listing.updatedAt)}</td>{canEdit && <td><button type="button" className="secondary" onClick={() => setEdit(listing)}>Edit</button></td>}</tr>)}</tbody></table></div>}
    </section>
    {edit && <ListingForm listing={edit === "new" ? undefined : edit} location={company?.location} busy={busy} run={run} onClose={() => setEdit(null)} />}
    {importing && <ImportListings busy={busy} run={run} onClose={() => setImporting(false)} />}
  </>;
}

function ListingForm({ listing, location, busy, run, onClose }: { listing?: Listing; location?: string; busy: string; run: RunAction; onClose: () => void }) {
  const [photoName, setPhotoName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (key: string) => String(values.get(key) ?? "").trim();
    const input: ListingInput = { id: listing?.id, name: value("name"), category: value("category"), description: value("description"), unit: value("unit"), priceCents: value("price") ? cents(value("price")) : null, available: Number(value("available")), minimum: Number(value("minimum")), packSize: Number(value("packSize")), deliveryAreas: value("deliveryAreas").split(",").map((area) => area.trim()).filter(Boolean), leadDays: Number(value("leadDays")), deliveryFeeCents: cents(value("deliveryFee")), collection: values.has("collection"), surplus: values.has("surplus"), archived: values.has("archived"), brand: value("brand") };
    const photo = values.get('photo');
    if (photo instanceof File && photo.size) {
      const upload = new FormData();
      upload.set('photo', photo);
      upload.set('listing', JSON.stringify(input));
      if (await run('saveListingPhoto', upload, 'Listing and photo saved.')) onClose();
      return;
    }
    if (await run("saveListing", { listing: input }, "Listing saved.")) onClose();
  }
  return <Dialog title={listing ? "Edit listing" : "Create stock listing"} onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><div className="form-grid">
    <label className="field full">Product name<input name="name" minLength={2} maxLength={180} defaultValue={listing?.name} required /></label><label className="field">Category<input name="category" maxLength={90} defaultValue={listing?.category} required /></label><label className="field">Brand<input name="brand" maxLength={100} defaultValue={listing?.brand} /></label>
    <label className="field full">{listing?.image ? 'Replace product photo' : 'Product photo'}<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoName(event.currentTarget.files?.[0]?.name ?? '')} /><small>{photoName || (listing?.image ? 'The current photo stays if you leave this blank.' : 'Optional. JPEG, PNG or WebP up to 8 MB.')}</small></label>
    <label className="field full">Description and specifications<textarea name="description" maxLength={2000} defaultValue={listing?.description} /></label><label className="field">Unit<input name="unit" maxLength={40} defaultValue={listing?.unit ?? "cases"} required /></label><label className="field">Units per pack<input name="packSize" type="number" min="1" max="100000" defaultValue={listing?.packSize ?? 1} required /></label>
    <label className="field">Available quantity<input name="available" type="number" min="0" max="1000000" defaultValue={listing?.available ?? 0} required /></label><label className="field">Minimum order<input name="minimum" type="number" min="1" max="100000" defaultValue={listing?.minimum ?? 1} required /></label>
    <label className="field">Listed price (ZAR)<input name="price" type="number" min="0" max="1000000" step="0.01" defaultValue={listing?.priceCents == null ? "" : listing.priceCents / 100} /><small>Leave blank to request a quote.</small></label><label className="field">Delivery fee (ZAR)<input name="deliveryFee" type="number" min="0" max="1000000" step="0.01" defaultValue={(listing?.deliveryFeeCents ?? 0) / 100} required /></label>
    <label className="field">Lead time (days)<input name="leadDays" type="number" min="0" max="365" defaultValue={listing?.leadDays ?? 1} required /></label><label className="field">Delivery areas<input name="deliveryAreas" defaultValue={listing?.deliveryAreas.join(", ") || location} /><small>Separate areas with commas.</small></label>
    <label className="check"><input type="checkbox" name="collection" defaultChecked={listing?.collection ?? true} />Offer collection</label><label className="check"><input type="checkbox" name="surplus" defaultChecked={listing?.surplus ?? false} />Surplus stock</label>{listing && <label className="check"><input type="checkbox" name="archived" defaultChecked={listing.archived} />Archive listing</label>}
  </div><div><button type="submit" className="primary" disabled={!!busy}>{busy === 'saveListingPhoto' ? 'Saving photo…' : 'Save listing'}</button></div></form></Dialog>;
}

function ImportListings({ busy, run, onClose }: { busy: string; run: RunAction; onClose: () => void }) {
  const [data, setData] = useState<ListingInput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  async function read(file: File | undefined) {
    setErrors([]);
    setData([]);
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 1_000_000) throw new Error("Choose a CSV file under 1 MB.");
      const result = validateCsv(await file.text());
      setErrors(result.errors);
      setData(result.listings);
    } catch (caught) { setErrors([caught instanceof Error ? caught.message : "CSV could not be read."]); }
    finally { setReading(false); }
  }
  return <Dialog title="Import listings" onClose={onClose}><div className="stack"><p className="small-note">Use the template to add up to 100 listings. Prices and delivery fees are in rand.</p><div><button type="button" className="secondary" onClick={() => download("stockpact-listing-template.csv", csv([columns, sample]), "text/csv;charset=utf-8")}><Download size={16} />Download template</button></div><label className="field">CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => void read(event.currentTarget.files?.[0])} /></label>
    {errors.length > 0 && <ul className="notice notice-error" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    {data.length > 0 && <p className="small-note">{data.length} valid rows. {errors.length ? "Fix the marked rows before importing." : "Ready to add as new listings."}</p>}
    <div><button type="button" className="primary" disabled={!!busy || reading || !data.length || !!errors.length} onClick={async () => { if (await run("importListings", { listings: data }, `Imported ${data.length} listings.`)) onClose(); }}><Upload size={16} />Import listings</button></div>
  </div></Dialog>;
}
