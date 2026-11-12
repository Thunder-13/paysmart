import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libsql ships a native addon per platform; keep it out of the bundle so it is required and traced from node_modules.
  serverExternalPackages: ["libsql"],
  // Live ledger app: every page reads SQLite at request time, so static caching buys nothing.
  // cacheComponents stays off so route handlers can declare runtime = "nodejs".
  turbopack: {
    root: path.resolve("."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
