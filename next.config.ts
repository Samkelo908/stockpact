import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.STOCKPACT_ISOLATED_BUILD === 'release' ? '.next-release'
    : process.env.STOCKPACT_ISOLATED_BUILD === 'true' ? '.next-isolated' : '.next',
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default config;
