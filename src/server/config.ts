/** Mode resolution from env. No side effects; safe to import from server components. */
export interface ResolvedConfig {
  paypalMode: "sandbox" | "mock";
  aiMode: "anthropic" | "mock";
  baseUrl: string;
  dataDir: string;
}

type Env = Record<string, string | undefined>;

function has(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
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
    baseUrl: (has(env.APP_BASE_URL) ? env.APP_BASE_URL : has(env.RENDER_EXTERNAL_URL) ? env.RENDER_EXTERNAL_URL : "http://localhost:3000").replace(/\/+$/, ""),
    dataDir: has(env.DATA_DIR) ? env.DATA_DIR : "./data",
  };
}
