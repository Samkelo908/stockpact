"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, ClipboardList, Copy, FileWarning, Plus, ShieldCheck, Star, Users } from "lucide-react";
import { WalletRegistration } from "../integrations/escrow/controls";
import { initialMarket, type Company, type Dispute, type MarketplaceState, type RequestDraft, type Review } from "../shared/marketplace";
import { cents, companyName, companyOf, type Navigate, type RunAction } from "./client";
import { HostedVerification } from "./hosted-verification";
import { Dialog, Empty, PanelTitle, Tag, ViewTitle, dateLabel, money, titleCase } from "./ui";

type Common = { state: MarketplaceState; busy: string; run: RunAction; navigate: Navigate; selected: string };
type ReviewRecord = Review & { reply?: { body: string; at: string }; reported?: boolean; hidden?: boolean; moderationNote?: string };
const verificationScopes = ["business", "representative", "delivery"] as const;
const needsReview = (status: Company["verification"][keyof Company["verification"]]) => status === "pending" || status === "action_required";

export function SettingsView({ state, busy, run, selected, navigate }: Common) {
  const company = companyOf(state, state.actor?.companyId);
  const [edit, setEdit] = useState(false);
  const [invite, setInvite] = useState(false);
  const [accept, setAccept] = useState(selected === "invite" || selected.startsWith("invite/"));
  const owner = state.actor?.role === "owner";
  if (!company) return <ViewTitle title="Company settings" subtitle="No company is available for this account." />;
  const hostedScopes = state.verificationProvider && !state.verificationProvider.sandbox ? state.verificationProvider.scopes : [];
  const canSubmitManual = company.demo || verificationScopes.some((scope) =>
    !hostedScopes.includes(scope) && (scope !== "delivery" || company.capabilities.includes("delivery")) &&
    !["verified", "pending"].includes(company.verification[scope]));

  return <>
    <ViewTitle title="Company settings" subtitle="Manage your company, verification and team access." action={owner ? <button type="button" className="secondary" onClick={() => setEdit(true)}><Building2 size={16} />Edit company</button> : undefined} />
    <div className="stack">
      <div className="dashboard-grid">
        <section className="card panel stack"><PanelTitle title={company.name} subtitle={company.legalName} action={company.demo ? <Tag value="Fictional business" variant="amber" /> : undefined} />
          <dl className="details-grid"><div><dt>Country</dt><dd>{company.country}</dd></div><div><dt>Quote currency</dt><dd>{company.currency}</dd></div><div><dt>Business address</dt><dd>{company.location || "Add address"}</dd></div><div><dt>Registration</dt><dd>{company.registrationNumber || "Add registration number"}</dd></div><div><dt>Contact</dt><dd>{company.contact || "Add contact"}</dd></div><div><dt>Representative</dt><dd>{company.representative || "Add representative"}</dd></div><div><dt>Capabilities</dt><dd>{company.capabilities.map(titleCase).join(", ") || "None"}</dd></div><div><dt>Purchase approval threshold</dt><dd>{company.approvalThresholdCents != null ? money(company.approvalThresholdCents) : "Unset"}</dd></div></dl>
        </section>
        <section className="card panel stack"><PanelTitle title="Verification" subtitle={company.demo ? "Verification states belong to this fictional demo." : "Check the status of your business, representative and delivery services."} />
          {verificationScopes.map((scope) => <div className="subcard split-line" key={scope}><div><h3>{titleCase(scope)}</h3></div><Tag value={company.verification[scope]} /></div>)}
          {company.verificationNote && <div className="notice notice-warn"><FileWarning size={17} />{company.verificationNote}</div>}
          {owner && state.verificationProvider && <HostedVerification key={company.id} company={company} provider={state.verificationProvider} />}
          {owner && canSubmitManual && <div><button type="button" className="secondary" disabled={!!busy} onClick={() => void run("submitVerification", {}, "Verification submitted for review.")}><ShieldCheck size={16} />Submit for review</button></div>}
          {!!state.verificationHistory?.length && <ul className="timeline">{state.verificationHistory.filter((check) => check.companyId === company.id).slice(0, 6).map((check) =>
            <li key={check.id}><ShieldCheck size={14} /><span>{titleCase(check.scope)} · {titleCase(check.status)} · {titleCase(check.provider)}{check.note ? " · " + check.note : ""}</span><time dateTime={check.createdAt}>{dateLabel(check.createdAt)}</time></li>)}</ul>}
        </section>
      </div>
      <WalletRegistration state={state} run={run} busy={busy} />
      <section className="card panel stack"><PanelTitle title="Team access" subtitle="Membership roles apply to the active company." />
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Email</th><th>Role</th></tr></thead><tbody>{state.team.map((member) => <tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td>{titleCase(member.role)}</td></tr>)}</tbody></table></div>
        {!state.team.length && <Empty title="No other team members" detail="Company members and their roles are listed here." icon={Users} />}
        {!company.demo && <div className="button-row">{owner && <button type="button" className="primary" onClick={() => setInvite(true)}><Plus size={16} />Invite team member</button>}<button type="button" className="secondary" onClick={() => setAccept(true)}>Accept an invitation</button></div>}
      </section>
    </div>
    {edit && <CompanyForm company={company} busy={busy} run={run} onClose={() => setEdit(false)} />}
    {invite && <InvitationForm busy={busy} run={run} onClose={() => setInvite(false)} />}
    {accept && !company.demo && <Dialog title="Accept company invitation" onClose={() => { setAccept(false); if (selected.startsWith("invite")) navigate("settings"); }}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (await run("acceptInvitation", { code: fields.get("code") }, "Invitation accepted. Open the account menu to switch companies.")) { setAccept(false); navigate("settings"); } }}><label className="field">Invitation code<input name="code" defaultValue={selected.startsWith("invite/") ? selected.slice(7) : ""} minLength={64} maxLength={64} required /></label><div><button type="submit" className="primary" disabled={!!busy}>Join company</button></div></form></Dialog>}
  </>;
}

function CompanyForm({ company, busy, run, onClose }: { company: Company; busy: string; run: RunAction; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { threshold, capability: ignored, ...fields } = Object.fromEntries(form);
    void ignored;
    const result = await run("updateCompany", { company: { ...fields, capabilities: form.getAll("capability"), approvalThresholdCents: threshold ? cents(String(threshold)) : null } }, "Company details saved.");
    if (result) onClose();
  }
  return <Dialog title="Edit company details" onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><div className="form-grid">
    <label className="field">Trading name<input name="name" defaultValue={company.name} minLength={2} maxLength={150} required /></label><label className="field">Legal name<input name="legalName" defaultValue={company.legalName} minLength={2} maxLength={150} required /></label>
    <label className="field">Country code<input name="country" value={initialMarket.country} readOnly /></label><label className="field">Quote currency code<input name="currency" value={initialMarket.currency} readOnly /></label>
    <label className="field full">Business or delivery address<input name="location" defaultValue={company.location} minLength={2} maxLength={250} required /></label><label className="field">Company registration number<input name="registrationNumber" defaultValue={company.registrationNumber} maxLength={80} /></label><label className="field">Company contact<input name="contact" defaultValue={company.contact} maxLength={200} /></label>
    <label className="field">Authorised representative<input name="representative" defaultValue={company.representative} maxLength={150} /></label><label className="field">Approval threshold<input type="number" name="threshold" min="0" max="1000000" step="0.01" defaultValue={company.approvalThresholdCents == null ? "" : company.approvalThresholdCents / 100} /><small>Leave blank to disable threshold approvals.</small></label>
    {(["buyer", "supplier", "delivery"] as const).map((capability) => <label key={capability} className="check"><input type="checkbox" name="capability" value={capability} defaultChecked={company.capabilities.includes(capability)} />{titleCase(capability)} capability</label>)}
  </div><div><button type="submit" className="primary" disabled={!!busy}>Save company details</button></div></form></Dialog>;
}

function InvitationForm({ busy, run, onClose }: { busy: string; run: RunAction; onClose: () => void }) {
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await run<{ code: string; expiresAt: string }>("inviteMember", Object.fromEntries(new FormData(event.currentTarget)));
    if (result?.data) setInvitation(result.data);
  }
  const link = invitation ? `${window.location.origin}${window.location.pathname}#settings/invite/${invitation.code}` : "";
  return <Dialog title="Invite team member" onClose={onClose}>{invitation ? <div className="stack"><p className="small-note">Share this link with the invited person. It expires {dateLabel(invitation.expiresAt)} and is tied to their email.</p><label className="field">Invitation link<input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label><div><button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { document.querySelector<HTMLInputElement>("dialog input[readonly]")?.select(); } }}><Copy size={16} />{copied ? "Copied" : "Copy link"}</button></div></div> : <form className="stack" onSubmit={(event) => void submit(event)}><label className="field">Business email<input name="email" type="email" required /></label><label className="field">Role<select name="role"><option value="purchaser">Purchasing staff</option><option value="approver">Purchase approver</option><option value="sales">Supplier sales</option><option value="driver">Delivery driver</option></select></label><div><button type="submit" className="primary" disabled={!!busy}>Create invite link</button></div></form>}</Dialog>;
}

export function Reviews({ state, busy, run, navigate, startDraft }: Common & { startDraft: (draft: RequestDraft) => void }) {
  const [save, setSave] = useState(false);
  const [reviewAction, setReviewAction] = useState<{ review: ReviewRecord; type: "reply" | "report" } | null>(null);
  const company = companyOf(state, state.actor?.companyId);
  const canSave = company?.capabilities.includes("buyer") && ["owner", "purchaser"].includes(state.actor?.role ?? "");
  const preferred = state.companies.filter((item) => state.preferredSuppliers.includes(item.id));
  const completed = state.orders.filter((item) => item.status === "completed" && item.buyerId === state.actor?.companyId);
  const drafts = state.requests.filter((item) => item.buyerId === state.actor?.companyId);
  const reviews: ReviewRecord[] = state.reviews;
  const role = state.actor?.role ?? "";
  const canReport = ["owner", "sales", "purchaser", "approver"].includes(role);
  return <>
    <ViewTitle title="Suppliers & reviews" subtitle="Find preferred suppliers, verified-order reviews and saved purchases." />
    <div className="stack">
      <div className="dashboard-grid">
        <section className="card panel stack"><PanelTitle title="Verified-order reviews" />{reviews.length ? reviews.map((review) => <article key={review.id} className="subcard small-stack"><div className="split-line"><div><h3>{companyName(state, review.supplierId)}</h3><p>{dateLabel(review.createdAt)}</p></div><span className="rating"><Star size={15} />{review.rating}/5</span></div><p>{review.comment}</p><p>Quality {review.quality} · Reliability {review.reliability} · Accuracy {review.accuracy} · Communication {review.communication}</p><div><Tag value={review.demo ? "Demo review" : "Verified order"} variant={review.demo ? "amber" : "green"} /></div>{review.reply && <div className="chat-bubble"><strong>Supplier reply · {dateLabel(review.reply.at)}</strong><p>{review.reply.body}</p></div>}<div className="button-row">{review.supplierId === state.actor?.companyId && ["owner", "sales"].includes(role) && <button className="secondary" type="button" onClick={() => setReviewAction({ review, type: "reply" })}>{review.reply ? "Edit reply" : "Reply to review"}</button>}{canReport && review.buyerId !== state.actor?.companyId && !review.reported && <button className="secondary" type="button" onClick={() => setReviewAction({ review, type: "report" })}>Report review</button>}</div></article>) : <Empty title="No reviews yet" detail="Eligible buyers can leave a review from a completed order." icon={Star} />}</section>
        <section className="card panel stack"><PanelTitle title="Preferred suppliers" />{preferred.map((item) => <article key={item.id} className="subcard split-line"><div><h3>{item.name}</h3><p>{item.location}</p></div><button type="button" className="secondary" disabled={!!busy} onClick={() => void run("preferSupplier", { supplierId: item.id })}>Remove</button></article>)}{!preferred.length && <Empty title="No preferred suppliers" detail="Open a marketplace listing to prefer its supplier." icon={Building2} />}</section>
      </div>
      <section className="card panel stack"><PanelTitle title="Shopping lists" subtitle="Start a fresh request from a saved item to check current pricing and availability." action={canSave && drafts.length ? <button type="button" className="secondary" onClick={() => setSave(true)}><Plus size={16} />New list</button> : undefined} />
        {state.shoppingLists.map((list) => <article className="subcard small-stack" key={list.id}><div className="split-line"><h3>{list.name}</h3>{list.remindAt && <span className="small-note">Reminder {dateLabel(list.remindAt)}</span>}</div>{list.items.map((item, index) => <button type="button" key={`${item.product}-${index}`} className="list-button" onClick={() => startDraft({ ...item, requiredDate: "", mode: "manual" })}><div><strong>{item.product}</strong><small>{item.quantity} {item.unit}</small></div><ArrowRight size={16} /></button>)}</article>)}
        {!state.shoppingLists.length && <Empty title="No saved shopping lists" detail={drafts.length ? "Save items from your existing requests for quick repeat purchasing." : "Create a request first, then save its items for repeat purchases."} icon={ClipboardList} />}
      </section>
      {completed.length > 0 && <section className="card panel stack"><PanelTitle title="Completed purchases" subtitle="Open an order to review your supplier or buy again." />{completed.map((order) => <button key={order.id} className="list-button" type="button" onClick={() => navigate("orders", order.id)}><div><strong>{order.product}</strong><small>{order.reference}</small></div><ArrowRight size={16} /></button>)}</section>}
    </div>
    {save && <Dialog title="Save shopping list" onClose={() => setSave(false)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const items = drafts.filter((request) => data.getAll("item").includes(request.id)).map((request) => request.draft); if (await run("saveShoppingList", { name: data.get("name"), items, remindAt: data.get("remindAt") || undefined }, "Shopping list saved.")) setSave(false); }}><label className="field">List name<input name="name" minLength={2} maxLength={100} required /></label><label className="field">Reminder date<input name="remindAt" type="date" /></label><fieldset className="small-stack"><legend>Include request items</legend>{drafts.map((request) => <label className="check" key={request.id}><input name="item" type="checkbox" value={request.id} />{request.draft.product} · {request.draft.quantity} {request.draft.unit}</label>)}</fieldset><div><button type="submit" className="primary" disabled={!!busy}>Save list</button></div></form></Dialog>}
    {reviewAction && <Dialog title={reviewAction.type === "reply" ? "Reply to review" : "Report review"} onClose={() => setReviewAction(null)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("message"); const reply = reviewAction.type === "reply"; if (await run(reply ? "replyReview" : "reportReview", { reviewId: reviewAction.review.id, [reply ? "body" : "reason"]: value }, reply ? "Reply published." : "Review reported for moderation.")) setReviewAction(null); }}><label className="field">{reviewAction.type === "reply" ? "Reply" : "Reason for report"}<textarea name="message" defaultValue={reviewAction.type === "reply" ? reviewAction.review.reply?.body : undefined} minLength={reviewAction.type === "reply" ? 2 : 4} maxLength={reviewAction.type === "reply" ? 1500 : 1400} required /></label><div><button type="submit" className="primary" disabled={!!busy}>{reviewAction.type === "reply" ? "Publish reply" : "Send report"}</button></div></form></Dialog>}
  </>;
}

export function Admin({ state, busy, run, navigate }: Common) {
  const [verification, setVerification] = useState<Company | null>(null);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [reset, setReset] = useState(false);
  const [moderate, setModerate] = useState<ReviewRecord | null>(null);
  const reviewable = state.companies.filter((item) => !state.actor?.memberships.some(({ companyId }) => item.id === companyId) &&
    Object.values(item.verification).some(needsReview));
  const reviews = (state.reviews as ReviewRecord[]).filter((review) => review.reported || review.hidden);
  const verificationHistory = state.verificationHistory?.filter((check) => check.companyId === verification?.id).slice(0, 8) ?? [];
  return <>
    <ViewTitle title="Platform administration" subtitle="Review company verification, delivery disputes and reported reviews." action={state.actor?.demoRole === "admin" ? <button type="button" className="secondary" onClick={() => setReset(true)}>Reset fictional demo</button> : undefined} />
    <div className="stack"><div className="dashboard-grid">
      <section className="card panel stack"><PanelTitle title="Verification queue" />{reviewable.map((item) => <button type="button" key={item.id} className="list-button" onClick={() => setVerification(item)}><div><strong>{item.name}</strong><small>{item.location}</small></div><Tag value="Review needed" variant="amber" /></button>)}{!reviewable.length && <Empty title="No verification checks pending" detail="Submitted company checks will appear here." icon={ShieldCheck} />}</section>
      <section className="card panel stack"><PanelTitle title="Disputes" />{state.disputes.map((item) => <article className="subcard small-stack" key={item.id}><div className="split-line"><h3>{state.orders.find((order) => order.id === item.orderId)?.reference ?? "Order dispute"}</h3><Tag value={item.status} /></div><p>{item.reason}</p><p>{item.quantity} disputed · {money(item.amountCents)}</p>{item.resolution && <p>{item.resolution}</p>}<div className="button-row"><button className="secondary" type="button" onClick={() => navigate("orders", item.orderId)}>View order</button>{item.status === "open" && <button className="primary" type="button" onClick={() => setDispute(item)}>Resolve</button>}</div></article>)}{!state.disputes.length && <Empty title="No disputes to review" detail="Reported handover issues appear here." icon={FileWarning} />}</section>
    </div><section className="card panel stack"><PanelTitle title="Review moderation" />{reviews.map((review) => <article className="subcard stack" key={review.id}><div className="split-line"><div><h3>{companyName(state, review.supplierId)}</h3><p>{review.comment}</p></div><Tag value={review.hidden ? "Hidden" : "Reported"} variant={review.hidden ? "grey" : "amber"} /></div>{review.moderationNote && <p>{review.moderationNote}</p>}<div><button type="button" className="secondary" onClick={() => setModerate(review)}>Moderate review</button></div></article>)}{!reviews.length && <Empty title="No reported reviews" detail="Reports from buyers and suppliers appear here." icon={Star} />}</section></div>
    {verification && <Dialog title={`Review ${verification.name}`} onClose={() => setVerification(null)}><form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const scope = verificationScopes.find((entry) => entry === fields.get("scope"));
      if (scope && await run("reviewVerification", { companyId: verification.id, scope, status: fields.get("status"),
        note: fields.get("note"), reviewId: verification.verificationReviewIds?.[scope] }, "Verification review recorded.")) setVerification(null);
    }}><dl className="details-grid"><div><dt>Legal name</dt><dd>{verification.legalName}</dd></div><div><dt>Registration</dt><dd>{verification.registrationNumber || "Pending"}</dd></div><div><dt>Business address</dt><dd>{verification.location || "Pending"}</dd></div><div><dt>Representative</dt><dd>{verification.representative || "Pending"}</dd></div></dl>
      {verificationHistory.length > 0 && <section className="small-stack" aria-label="Verification history"><strong>Recent verification checks</strong>{verificationHistory.map((check) => <article key={check.id} className="subcard small-stack"><div className="split-line"><div><h3>{titleCase(check.scope)}</h3><p>{titleCase(check.provider)} · {dateLabel(check.createdAt)}</p></div><Tag value={check.status} /></div>{check.providerReference && <p>Provider reference <code>{check.providerReference}</code></p>}{check.note && <p>{check.note}</p>}</article>)}</section>}
      <label className="field">Scope<select name="scope" required>{verificationScopes.filter((scope) => needsReview(verification.verification[scope])).map((scope) => <option value={scope} key={scope}>{titleCase(scope)}</option>)}</select></label><label className="field">Outcome<select name="status"><option value="verified">Verified</option><option value="action_required">Action required</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label><label className="field">Reviewer note<textarea name="note" maxLength={1600} /></label><div><button className="primary" type="submit" disabled={!!busy}>Record review</button></div></form></Dialog>}
    {dispute && <Dialog title="Resolve delivery dispute" onClose={() => setDispute(null)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (await run("resolveDispute", { disputeId: dispute.id, resolution: fields.get("resolution"), refund: fields.has("refund") }, "Dispute resolution recorded.")) setDispute(null); }}><p className="small-note">{dispute.reason}</p><label className="field">Resolution<textarea name="resolution" required minLength={3} maxLength={1500} /></label><label className="check"><input name="refund" type="checkbox" />Refund disputed demo funds to the buyer</label><div><button className="primary" type="submit" disabled={!!busy}>Record resolution</button></div></form></Dialog>}
    {moderate && <Dialog title="Moderate review" onClose={() => setModerate(null)}><form className="stack" onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (await run("moderateReview", { reviewId: moderate.id, hidden: fields.get("status") === "hidden", note: fields.get("note") }, "Review moderation recorded.")) setModerate(null); }}><label className="field">Visibility<select name="status" defaultValue={moderate.hidden ? "hidden" : "visible"}><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><label className="field">Moderation note<textarea name="note" minLength={4} maxLength={1400} required /></label><div><button className="primary" type="submit" disabled={!!busy}>Save moderation</button></div></form></Dialog>}
    {reset && <Dialog title="Reset fictional demo?" onClose={() => setReset(false)}><div className="stack"><p className="notice notice-warn">This restores the seeded demo companies, requests and orders. It clears changes to the fictional workspace.</p><div><button type="button" className="danger" disabled={!!busy} onClick={async () => { if (await run("resetDemo", {}, "Fictional demo reset.")) setReset(false); }}>Reset demo data</button></div></div></Dialog>}
  </>;
}
