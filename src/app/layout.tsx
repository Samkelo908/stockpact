import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "./globals.css";
import "../components/home.css";
import "../components/payments.css";
import "../components/market.css";
import { RegisterServiceWorker } from "./register-service-worker";

export const metadata: Metadata = {
  title: "StockPact | Procurement workspace",
  description: "Source business supplies, compare quotes, and manage handovers in one workspace.",
  applicationName: "StockPact",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "StockPact" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffd33d" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en-ZA"><body>{children}<RegisterServiceWorker /></body></html>;
}
