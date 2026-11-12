/** Mode resolution from env. No side effects; safe to import from server components. */
export interface ResolvedConfig {
  paypalMode: "sandbox" | "mock";
  aiMode: "anthropic" | "mock";
  baseUrl: string;
  dataDir: string;
  /** Shared remote libSQL (Turso) database; null means local node:sqlite under dataDir. */
  libsqlUrl: string | null;
  libsqlAuthToken: string | null;
}

type Env = Record<string, string | undefined>;

function has(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Vercel sets these hostnames without a scheme. Production links use the stable project domain. */
function vercelUrl(env: Env): string | undefined {
  const host = env.VERCEL_ENV === "production" && has(env.VERCEL_PROJECT_PRODUCTION_URL) ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  return has(host) ? `https://${host}` : undefined;
}

export function resolveConfig(env: Env = process.env): ResolvedConfig {
  const paypalKeys = has(env.PAYPAL_CLIENT_ID) && has(env.PAYPAL_CLIENT_SECRET);
  const wantPaypal = (env.PAYPAL_MODE ?? (paypalKeys ? "sandbox" : "mock")).trim().toLowerCase();
  const aiKey = has(env.ANTHROPIC_API_KEY);
  const wantAi = (env.AI_MODE ?? (aiKey ? "anthropic" : "mock")).trim().toLowerCase();
  return {
    paypalMode: wantPaypal === "sandbox" && paypalKeys ? "sandbox" : "mock",
    aiMode: wantAi === "anthropic" && aiKey ? "anthropic" : "mock",
    // RENDER_EXTERNAL_URL is set by Render on every web service, so a fresh deploy links back to itself.
    // On Vercel, VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL play the same role.
    baseUrl: (has(env.APP_BASE_URL) ? env.APP_BASE_URL : has(env.RENDER_EXTERNAL_URL) ? env.RENDER_EXTERNAL_URL : vercelUrl(env) ?? "http://localhost:3000").replace(/\/+$/, ""),
    // Vercel functions can only write under /tmp, which is per instance and wiped on cold start.
    dataDir: has(env.DATA_DIR) ? env.DATA_DIR : env.VERCEL === "1" ? "/tmp/paysmart" : "./data",
    libsqlUrl: has(env.TURSO_DATABASE_URL) ? env.TURSO_DATABASE_URL.trim() : null,
    libsqlAuthToken: has(env.TURSO_AUTH_TOKEN) ? env.TURSO_AUTH_TOKEN.trim() : null,
  };
}
