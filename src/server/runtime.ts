/**
 * Process-wide Runtime built from env, cached on globalThis so it survives Next dev HMR.
 *   PAYPAL_MODE   sandbox only when PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET exist, else mock
 *   AI_MODE       anthropic only when ANTHROPIC_API_KEY exists, else mock
 *   APP_BASE_URL  default RENDER_EXTERNAL_URL (on Render), else http://localhost:3000
 *   DATA_DIR      default ./data (SQLite file permission-slip.db)
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN  shared remote libSQL store instead of the local file
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createAnthropicAI } from "@/core/ai/anthropic";
import { createMockAI } from "@/core/ai/mock";
import { asMockRail, createMockRail, type MockRail } from "@/core/rail/mock";
import { createSandboxRail } from "@/core/rail/sandbox";
import { buildRuntime, type AppRuntime } from "@/core/runtime-factory";
import { createLibsqlStore, createSqliteStore } from "@/core/store/sqlite";
import { pipelines } from "@/pipelines/registry";
import { resolveConfig, type ResolvedConfig } from "./config";
import { restoreDemoDisputes } from "./demo-restore";

export type ServerRuntime = AppRuntime & {
  config: ResolvedConfig;
  /** The mock rail's controls in mock mode, null against the real sandbox. */
  mockRail: MockRail | null;
};

const KEY = "__permissionSlipRuntime";

function createServerRuntime(env: Record<string, string | undefined> = process.env): ServerRuntime {
  const config = resolveConfig(env);
  if (!config.libsqlUrl) mkdirSync(config.dataDir, { recursive: true });
  const store = config.libsqlUrl
    ? createLibsqlStore({ url: config.libsqlUrl, authToken: config.libsqlAuthToken ?? undefined })
    : createSqliteStore(path.join(config.dataDir, "permission-slip.db"));
  const rail =
    config.paypalMode === "sandbox"
      ? createSandboxRail({
          clientId: env.PAYPAL_CLIENT_ID ?? "",
          clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
          webhookId: env.PAYPAL_WEBHOOK_ID ?? "",
          baseUrl: env.PAYPAL_API_BASE || undefined,
        })
      : // With a shared database (several Vercel instances), the mock rail keeps its state there too,
        // so an order made on one instance can be approved on another.
        createMockRail({ baseUrl: config.baseUrl, store: config.libsqlUrl ? store : undefined });
  const ai =
    config.aiMode === "anthropic"
      ? createAnthropicAI({
          apiKey: env.ANTHROPIC_API_KEY,
          models: { smart: env.ANTHROPIC_MODEL_SMART, fast: env.ANTHROPIC_MODEL_FAST },
        })
      : createMockAI();
  const runtime = buildRuntime({ store, rail, ai, pipelines, baseUrl: config.baseUrl }) as ServerRuntime;
  runtime.config = config;
  runtime.mockRail = asMockRail(rail);
  // The mock rail keeps disputes in memory; put back the ones a demo seed created before this boot.
  restoreDemoDisputes(store, runtime.mockRail);
  return runtime;
}

export function getRuntime(): ServerRuntime {
  const g = globalThis as typeof globalThis & { [KEY]?: ServerRuntime };
  if (!g[KEY]) g[KEY] = createServerRuntime();
  return g[KEY];
}
