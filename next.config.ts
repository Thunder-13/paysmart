import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
