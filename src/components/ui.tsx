"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, PackageOpen, X, type LucideIcon } from "lucide-react";

export const money = (cents: number, currency = "ZAR") => new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(cents / 100);
export const number = (value: number) => new Intl.NumberFormat("en-ZA").format(value);
export const dateLabel = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
export const DialogError = createContext("");

export function titleCase(value: string) {
  const formatted = value.replace(/[-_]/g, " ");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function Tag({ value, variant }: { value: string; variant?: "green" | "amber" | "blue" | "red" | "grey" }) {
  const colour = variant ?? (/complete|accepted|verified|confirm|paid|funded|active|resolved/.test(value) ? "green" : /pending|await|partial|review|demo/.test(value) ? "amber" : /expired|reject|dispute|cancel|fail/.test(value) ? "red" : /sent|dispatch|progress|submitted|processing/.test(value) ? "blue" : "grey");
  return <span className={`tag tag-${colour}`}><span aria-hidden="true" />{titleCase(value)}</span>;
}

export function ViewTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <header className="view-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

export function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function Empty({ title, detail, action, icon: Icon = PackageOpen }: { title: string; detail: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="empty-state"><div className="icon-tile mint"><Icon size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="text-button" onClick={onClick}>{children}<ArrowRight size={15} /></button>;
}

export function Busy({ label }: { label: string }) {
  return <div className="inline-busy" role="status"><LoaderCircle className="spin" size={18} />{label}</div>;
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  const error = useContext(DialogError);
  useEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={element} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
    {error && <div className="notice notice-error dialog-error" role="alert"><CircleAlert size={16} />{error}</div>}
    {children}
  </dialog>;
}
