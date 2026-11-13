import type { Company, MarketplaceState } from "../shared/marketplace";

export type View = "home" | "assistant" | "marketplace" | "requests" | "orders" | "inventory" | "deliveries" | "funds" | "reviews" | "settings" | "admin";
export const views: View[] = ["home", "assistant", "marketplace", "requests", "orders", "inventory", "deliveries", "funds", "reviews", "settings", "admin"];
export type Navigate = (view: View, selected?: string) => void;
export type Result<T = unknown> = { state: MarketplaceState; data?: T };
export type RunAction = <T = unknown>(action: string, values?: Record<string, unknown> | FormData, success?: string) => Promise<Result<T> | null>;

export class WorkspaceReconnectError extends Error {
  constructor() { super('Your workspace session needs to reconnect.'); }
}

export async function workspaceJson<T>(path: string, options: RequestInit = {}): Promise<{ response: Response; data: T & { error?: string } }> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Requested-With', 'XMLHttpRequest');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
  const json = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400) ||
      (!json && (response.status === 401 || response.status === 403))) throw new WorkspaceReconnectError();
  if (!json) throw new Error('The workspace could not respond. Check your connection and try again.');
  try { return { response, data: await response.json() }; }
  catch { throw new Error('The workspace sent an incomplete response. Try again.'); }
}

export function companyOf(state: MarketplaceState, id: string | undefined): Company | undefined {
  return state.companies.find((company) => company.id === id);
}

export function companyName(state: MarketplaceState, id: string): string {
  return companyOf(state, id)?.name ?? "StockPact business";
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
}

export function cents(input: string): number {
  const [whole, decimal = ""] = input.trim().split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0").slice(0, 2));
}

export function download(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  if (navigator.userAgent.includes("StockPactAndroid/")) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const target = window as Window & { stockPactAndroidExport?: () => string };
      target.stockPactAndroidExport = () => String(reader.result).split(",", 2)[1] ?? "";
      window.location.assign(`stockpact-export://save?${new URLSearchParams({ name, type: blob.type.split(";")[0] })}`);
    });
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  saveDownload(name, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function saveDownload(name: string, url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

export function csv(rows: (string | number | undefined)[][]) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
