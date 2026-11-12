import type { Company, MarketplaceState } from "../shared/marketplace";

export type View = "home" | "assistant" | "marketplace" | "requests" | "orders" | "inventory" | "deliveries" | "funds" | "reviews" | "settings" | "admin";
export const views: View[] = ["home", "assistant", "marketplace", "requests", "orders", "inventory", "deliveries", "funds", "reviews", "settings", "admin"];
export type Navigate = (view: View, selected?: string) => void;
export type Result<T = unknown> = { state: MarketplaceState; data?: T };
export type RunAction = <T = unknown>(action: string, values?: Record<string, unknown>, success?: string) => Promise<Result<T> | null>;

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
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function csv(rows: (string | number | undefined)[][]) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
