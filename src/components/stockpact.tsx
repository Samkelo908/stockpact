"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Banknote, Bell, Boxes, Building2, ChevronDown, ChevronRight, CircleAlert, CircleCheck, ClipboardList, House, LogOut, Menu, Package, PackageCheck, Search, Settings, ShieldCheck, Star, Store, Truck, X, type LucideIcon } from "lucide-react";
import type { MarketplaceState, RequestDraft } from "../shared/marketplace";
import { companyOf, initials, views, type Navigate, type Result, type RunAction, type View } from "./client";
import { Assistant, Dashboard } from "./purchasing";
import { Requests } from "./requests";
import { Funds, Orders } from "./orders";
import { Deliveries } from "./delivery-qr";
import { Inventory, Marketplace } from "./catalogue";
import { Admin, Reviews, SettingsView } from "./settings";
import { Busy, Dialog, DialogError, Empty, Tag, dateLabel, titleCase } from "./ui";

const nav: { id: View; title: string; short: string; icon: LucideIcon; group: "Workspace" | "Operations" | "Account" }[] = [
  { id: "home", title: "Overview", short: "Home", icon: House, group: "Workspace" },
  { id: "assistant", title: "Source stock", short: "Source", icon: Search, group: "Workspace" },
  { id: "marketplace", title: "Marketplace", short: "Market", icon: Store, group: "Workspace" },
  { id: "requests", title: "Requests & quotes", short: "Requests", icon: ClipboardList, group: "Workspace" },
  { id: "orders", title: "Orders", short: "Orders", icon: PackageCheck, group: "Workspace" },
  { id: "inventory", title: "Inventory", short: "Stock", icon: Package, group: "Operations" },
  { id: "deliveries", title: "Deliveries", short: "Delivery", icon: Truck, group: "Operations" },
  { id: "funds", title: "Payments", short: "Payments", icon: Banknote, group: "Operations" },
  { id: "reviews", title: "Suppliers & reviews", short: "Reviews", icon: Star, group: "Operations" },
  { id: "settings", title: "Company settings", short: "Settings", icon: Settings, group: "Account" },
  { id: "admin", title: "Administration", short: "Admin", icon: ShieldCheck, group: "Account" },
];

type Route = { view: View; selected: string };
const start: Route = { view: "home", selected: "" };

function readRoute(): Route {
  const [section, ...details] = window.location.hash.slice(1).split("/");
  try { return views.includes(section as View) ? { view: section as View, selected: decodeURIComponent(details.join("/")) } : start; }
  catch { return start; }
}

function Brand({ onClick }: { onClick?: () => void }) {
  const brand = <><span className="brand-mark" aria-hidden="true"><Boxes size={22} /></span><span>StockPact</span></>;
  return onClick ? <button type="button" className="brand" aria-label="StockPact home" onClick={onClick}>{brand}</button> : <div className="brand">{brand}</div>;
}

export function StockPact() {
  const [state, setState] = useState<MarketplaceState | null>(null);
  const [route, setRoute] = useState<Route>(start);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState<"profile" | "notifications" | "more" | "search" | null>(null);
  const [query, setQuery] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const actionActive = useRef(false);
  const revision = useRef(0);
  const activePoll = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (actionActive.current || activePoll.current) return;
    activePoll.current = true;
    const version = revision.current;
    try {
      const response = await fetch("/api/state", { cache: "no-store", signal });
      const body = await response.json() as MarketplaceState & { error?: string };
      if (!response.ok) throw new Error(body.error || "StockPact could not load. Try again.");
      if (version === revision.current) { setState(body); setLoadError(""); }
    } catch (caught) {
      if (!signal?.aborted && !silent) setLoadError(caught instanceof Error ? caught.message : "Unable to connect. Try again.");
    } finally { activePoll.current = false; }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    const frame = window.requestAnimationFrame(() => { sync(); void refresh(abort.signal); });
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(abort.signal, true); }, 2800);
    return () => { abort.abort(); activePoll.current = false; window.cancelAnimationFrame(frame); window.clearInterval(interval); window.removeEventListener("hashchange", sync); };
  }, [refresh]);

  useEffect(() => {
    function searchShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setDialog("search"); }
    }
    window.addEventListener("keydown", searchShortcut);
    return () => window.removeEventListener("keydown", searchShortcut);
  }, []);

  const navigate: Navigate = (view, selected = "") => {
    const target = { view, selected };
    setRoute(target);
    const hash = `#${view}${selected ? `/${selected.split("/").map(encodeURIComponent).join("/")}` : ""}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    window.scrollTo({ top: 0, behavior: "instant" });
    setDialog(null);
  };

  const run: RunAction = async <T,>(action: string, values?: Record<string, unknown> | FormData, success?: string) => {
    if (actionActive.current) return null;
    actionActive.current = true;
    revision.current += 1;
    setBusy(action);
    setNotice(null);
    try {
      const response = action === "saveListingPhoto" && values instanceof FormData
        ? await fetch("/api/listing-photo", { method: "POST", body: values })
        : await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, action }) });
      const result = await response.json() as Result<T> & { error?: string };
      if (result.state) setState(result.state);
      if (!response.ok || result.error) throw new Error(result.error || "That action could not be completed. Try again.");
      if (success) setNotice({ text: success, error: false });
      return result;
    } catch (caught) {
      setNotice({ text: caught instanceof Error ? caught.message : "Connection interrupted. Try again.", error: true });
      return null;
    } finally {
      actionActive.current = false;
      setBusy("");
    }
  };

  async function generate() {
    if (!prompt.trim() || busy) return;
    navigate("assistant");
    setDraft(null);
    const result = await run<RequestDraft>("draftRequest", { prompt: prompt.trim() });
    if (result?.data) setDraft(result.data);
  }

  const startDraft = (value: RequestDraft) => { setPrompt(""); setDraft(value); navigate("assistant"); };
  const showNotice = notice && <div className={`notice app-notice${notice.error ? " notice-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? <CircleAlert size={17} /> : <CircleCheck size={17} />}<span>{notice.text}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={17} /></button></div>;

  if (!state) return <main className="auth-screen"><section className="card auth-card stack"><Brand />{loadError ? <><p role="alert" className="notice notice-error"><CircleAlert size={17} />{loadError}</p><div><button className="primary" type="button" onClick={() => void refresh()}>Try again</button></div></> : <Busy label="Opening your procurement workspace" />}</section></main>;

  const authParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  if (!state.actor || authParams.has("token") || (authParams.has("reset") && authParams.get("error") === "INVALID_TOKEN")) return <AuthScreen state={state} busy={busy} run={run} notice={showNotice} />;

  const actor = state.actor;
  const company = companyOf(state, actor.companyId);
  const companyLabel = company?.name ?? actor.memberships[0]?.companyName ?? "Company workspace";
  const canBuy = company?.capabilities.includes("buyer") && ["owner", "purchaser"].includes(actor.role);
  const canSell = company?.capabilities.includes("supplier") && ["owner", "sales"].includes(actor.role);
  const links = nav.filter(({ id }) => {
    if (actor.role === "driver") return ["home", "orders", "deliveries", "settings"].includes(id);
    if (actor.role === "reviewer") return ["home", "orders", "admin", "settings"].includes(id);
    if (id === "admin") return false;
    if (id === "assistant") return canBuy;
    if (id === "inventory") return canSell;
    return true;
  });
  const current = links.find((item) => item.id === route.view);
  const navTitle = current?.title ?? "Overview";
  const composer = { state, prompt, setPrompt, draft, setDraft, busy, generate, navigate };
  const common = { state, busy, run, navigate, selected: route.selected };
  const unread = state.notifications.filter((notification) => !notification.read).length;

  function openMarket(event: FormEvent) {
    event.preventDefault();
    setMarketQuery(query);
    navigate("marketplace");
  }

  return <DialogError.Provider value={notice?.error ? notice.text : ""}><div className="app">
    <a className="skip-link" href="#workspace-content" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>Skip to content</a>
    <aside className="sidebar" aria-label="StockPact workspace">
      <Brand onClick={() => navigate("home")} />
      <button type="button" className="company-button" onClick={() => setDialog("profile")} aria-label="Switch company or demo role"><span className="company-avatar">{initials(companyLabel)}</span><div><strong>{companyLabel}</strong><small>{actor.demoRole ? "Demo workspace" : titleCase(actor.role)}</small></div><ChevronDown size={15} /></button>
      <nav aria-label="Workspace navigation">
        {(["Workspace", "Operations"] as const).map((group) => <div key={group}><p className="nav-label">{group}</p>{links.filter((item) => item.group === group).map(({ id, title, icon: Icon }) => <button key={id} type="button" className="nav-link" aria-current={route.view === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={17} />{title}</button>)}</div>)}
      </nav>
      <div className="sidebar-bottom">{links.filter((item) => item.group === "Account").map(({ id, title, icon: Icon }) => <button key={id} type="button" className="nav-link" aria-current={route.view === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={17} />{title}</button>)}</div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumbs" aria-label="Location in workspace"><span>Workspace</span><ChevronRight size={13} /><strong>{navTitle}</strong></div>
        <div className="mobile-brand"><Brand onClick={() => navigate("home")} />{actor.demoRole && <Tag value="Demo" variant="amber" />}</div>
        <div className="topbar-actions">
          {links.some((item) => item.id === "marketplace") && <button className="topbar-search" type="button" onClick={() => setDialog("search")}><Search size={15} />Search products<kbd>Ctrl K</kbd></button>}
          <button className="icon-button" type="button" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setDialog("notifications")}><Bell size={18} />{unread > 0 && <span className="notification-dot" />}</button>
          <button className="profile-button" type="button" aria-label="Account and demo roles" onClick={() => setDialog("profile")}>{initials(actor.name)}</button>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className="content">
        {showNotice}
        {!current && <section className="card panel"><Empty title="Workspace access required" detail="This area is unavailable for your active company and role." icon={ShieldCheck} action={<button type="button" className="secondary" onClick={() => navigate("home")}>Open overview</button>} /></section>}
        {current && <>{route.view === "home" && <Dashboard {...composer} />}
        {route.view === "assistant" && <Assistant {...composer} run={run} />}
        {route.view === "marketplace" && <Marketplace {...common} query={marketQuery} setQuery={setMarketQuery} startDraft={startDraft} />}
        {route.view === "requests" && <Requests {...common} startDraft={startDraft} />}
        {route.view === "orders" && <Orders {...common} startDraft={startDraft} />}
        {route.view === "inventory" && <Inventory {...common} />}
        {route.view === "deliveries" && <Deliveries {...common} />}
        {route.view === "funds" && <Funds state={state} navigate={navigate} busy={busy} run={run} />}
        {route.view === "reviews" && <Reviews {...common} startDraft={startDraft} />}
        {route.view === "settings" && <SettingsView key={actor.companyId} {...common} />}
        {route.view === "admin" && <Admin {...common} />}</>}
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">{links.filter((item) => (actor.role === "driver" ? ["home", "orders", "deliveries"] : actor.role === "reviewer" ? ["home", "orders", "admin"] : ["home", "marketplace", "orders", "funds"]).includes(item.id)).map(({ id, short, icon: Icon }) => <button key={id} type="button" aria-current={route.view === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={19} />{short}</button>)}<button type="button" onClick={() => setDialog("more")}><Menu size={20} />More</button></nav>
    {dialog === "more" && <Dialog title="Workspace navigation" onClose={() => setDialog(null)}><div className="small-stack">{links.map(({ id, title, icon: Icon }) => <button type="button" key={id} className="list-button" onClick={() => navigate(id)}><Icon size={17} /><div><strong>{title}</strong></div><ChevronRight size={15} /></button>)}</div></Dialog>}
    {dialog === "search" && <Dialog title="Search marketplace" onClose={() => setDialog(null)}><form className="stack" onSubmit={openMarket}><label className="field">Product, category or supplier<input type="search" autoFocus value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search products" /></label><div><button className="primary" type="submit"><Search size={16} />Search marketplace</button></div></form></Dialog>}
    {dialog === "profile" && <Dialog title="Account & workspace" onClose={() => setDialog(null)}><div className="stack">
      <div className="subcard"><h3>{actor.name}</h3><p>{actor.email} · {titleCase(actor.role)}</p></div>
      {actor.memberships.length > 1 && <div className="small-stack"><strong>Switch company</strong>{actor.memberships.map((membership) => <button type="button" className="list-button" key={membership.companyId} disabled={!!busy} aria-pressed={membership.companyId === actor.companyId} onClick={async () => { if (await run("switchCompany", { companyId: membership.companyId }, "Company workspace switched.")) { setDraft(null); navigate("home"); } }}><Building2 size={17} /><div><strong>{membership.companyName}</strong><small>{titleCase(membership.role)}</small></div></button>)}</div>}
      {actor.demoRole && !!state.roles.length && <div className="small-stack"><div className="split-line"><strong>Switch demo role</strong><Tag value="Fictional data" variant="amber" /></div>{state.roles.map((role) => <button type="button" className="list-button" key={role.role} disabled={!!busy} aria-pressed={actor.demoRole === role.role} onClick={async () => { if (await run("switchRole", { role: role.role }, `Switched to ${role.name}.`)) { setDraft(null); setPrompt(""); setDialog(null); } }}><span className="company-avatar">{initials(role.name)}</span><div><strong>{role.label}</strong><small>{role.name}</small></div><ChevronRight size={15} /></button>)}</div>}
      <div className="button-row"><button type="button" className="secondary" onClick={() => navigate("settings")}><Settings size={16} />Company settings</button><button type="button" className="secondary" disabled={!!busy} onClick={async () => { if (await run("signOut")) { setDraft(null); setPrompt(""); setDialog(null); } }}><LogOut size={16} />{actor.demoRole ? "Business sign-in" : "Sign out"}</button></div>
    </div></Dialog>}
    {dialog === "notifications" && <Dialog title="Notifications" onClose={() => setDialog(null)}><div className="small-stack">{state.notifications.length ? state.notifications.map((item) => <button key={item.id} type="button" className="list-button" disabled={!!busy} onClick={async () => {
      if (!item.read) await run("readNotification", { notificationId: item.id });
      const [section, ...details] = item.href.replace(/^#/, "").split("/");
      if (views.includes(section as View)) navigate(section as View, details.join("/"));
    }}><div><strong>{item.title}</strong><small>{item.body}</small><small>{dateLabel(item.createdAt)}</small></div>{!item.read && <Tag value="Unread" variant="green" />}</button>) : <Empty title="You’re up to date" detail="Quotes, order updates and handovers will appear here." icon={Bell} />}</div></Dialog>}
  </div></DialogError.Provider>;
}

function AuthScreen({ state, busy, run, notice }: { state: MarketplaceState; busy: string; run: RunAction; notice: React.ReactNode }) {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const invalidReset = params.has("reset") && params.get("error") === "INVALID_TOKEN";
  const [mode, setMode] = useState<"signIn" | "register" | "recovery" | "reset">(params.has("token") ? "reset" : invalidReset ? "recovery" : "signIn");
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(invalidReset ? { error: true, text: "This reset link has expired or was already used. Request a new link." } : null);

  function clearRecoveryLink() {
    for (const name of ["token", "reset", "error"]) params.delete(name);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setStatus(null);
    if (mode === "signIn" || mode === "register") { await run(mode, values); return; }
    const resetting = mode === "reset";
    const result = await run<{ message: string }>(resetting ? "resetPassword" : "requestPasswordReset", resetting ? { password: values.password, token: params.get("token") } : { email: values.email });
    if (result?.data) setStatus({ error: false, text: result.data.message });
    if (resetting && result) {
      clearRecoveryLink();
      setMode("signIn");
    }
  }

  return <main className="auth-screen"><section className="card auth-card stack">
    <Brand />
    <div><h1>{mode === "register" ? "Register your business" : mode === "recovery" ? "Recover your account" : mode === "reset" ? "Set a new password" : "Sign in to StockPact"}</h1><p className="small-note">{mode === "register" ? "Create a company workspace to start business verification." : mode === "recovery" ? "Request a password reset link by email." : mode === "reset" ? "Choose a password with at least 10 characters." : "Access your procurement workspace."}</p></div>
    {notice}
    {status && <p className={`notice${status.error ? " notice-error" : ""}`} role={status.error ? "alert" : "status"}>{status.text}</p>}
    <form className="stack" onSubmit={(event) => void submit(event)}>
      {mode === "register" && <><label className="field">Full name<input name="name" autoComplete="name" required /></label><label className="field">Company name<input name="companyName" autoComplete="organization" required /></label></>}
      {mode !== "reset" && <label className="field">Business email<input type="email" name="email" autoComplete="email" required /></label>}
      {mode !== "recovery" && <label className="field">Password<input type="password" name="password" minLength={10} autoComplete={mode === "signIn" ? "current-password" : "new-password"} required /></label>}
      <button type="submit" className="primary" disabled={!!busy}>{mode === "register" ? "Create workspace" : mode === "recovery" ? "Request reset link" : mode === "reset" ? "Update password" : "Sign in"}<ArrowRight size={16} /></button>
    </form>
    <div className="button-row"><button type="button" className="secondary" onClick={() => { if (mode === "reset" || invalidReset) clearRecoveryLink(); setStatus(null); setMode(mode === "signIn" ? "register" : "signIn"); }}>{mode === "signIn" ? "Register a business" : "Back to sign-in"}</button>{mode === "signIn" && <button type="button" className="secondary" onClick={() => { setStatus(null); setMode("recovery"); }}>Forgot password</button>}</div>
    {mode !== "reset" && !invalidReset && state.demo && !!state.roles.length && <button type="button" className="secondary" disabled={!!busy} onClick={() => void run("switchRole", { role: "buyer" })}><Boxes size={16} />Open fictional demo</button>}
  </section></main>;
}
