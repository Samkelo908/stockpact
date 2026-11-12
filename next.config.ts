import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default config;
