import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "@/pipelines/cash-weather/fixtures";
import { DEFAULT_BALANCE, DEFAULT_BUFFER, DEFAULT_CAP, DEFAULT_PRINCIPAL, DEFAULT_SEED } from "@/pipelines/cash-weather/types";

export const runtime = "nodejs";

/**
 * GET /api/p/cash-weather/sample-input -> the fixture studio's run input, ready to POST to
 * /api/runs as {pipeline: "cash-weather", input}. Lets demo scripts start a run without importing
 * pipeline code.
 */
export function GET(): Response {
  return Response.json({
    packageJson: DEFAULT_PACKAGE_JSON,
    importCounts: DEFAULT_IMPORT_COUNTS,
    currentBalance: { currency: "USD", value: DEFAULT_BALANCE },
    safetyBuffer: { currency: "USD", value: DEFAULT_BUFFER },
    monthlyCap: { currency: "USD", value: DEFAULT_CAP },
    seed: DEFAULT_SEED,
    principal: DEFAULT_PRINCIPAL,
  });
}
