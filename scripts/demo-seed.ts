/**
 * Loads the demo story into DATA_DIR: all seven pipelines run to the end in mock mode (no keys, no
 * network), then prints one row per pipeline. Exits 1 if a run did not finish or a chain fails.
 * Running it again on the same DATA_DIR adds nothing and prints the same table.
 *
 *   npm run demo:seed
 *   DATA_DIR=$(mktemp -d) npm run -s demo:seed
 */
import { formatDemoTable, loadDemoStory } from "../src/server/demo-seed";
import { getRuntime } from "../src/server/runtime";

// Mock mode only: scripts never call the real PayPal or Anthropic APIs.
for (const [key, value] of [
  ["PAYPAL_MODE", "mock"],
  ["AI_MODE", "mock"],
] as const) {
  if (process.env[key] && process.env[key] !== value) console.log(`${key}=${process.env[key]} ignored: the demo seed runs in mock mode.`);
  process.env[key] = value;
}
delete process.env.CHANNEL3_API_KEY;
// The Toll Road page animates fetches in mock mode; a script has nobody to watch.
process.env.TOLL_ROAD_MOCK_DELAY_MS ??= "0";

async function main(): Promise<void> {
  const rt = getRuntime();
  console.log(`Demo story -> ${rt.config.dataDir} (PayPal ${rt.rail.mode}, AI ${rt.ai.mode})`);
  const result = await loadDemoStory(rt);
  console.log(result.message);
  console.log("");
  console.log(formatDemoTable(result.rows));
  console.log("");
  const support = result.doc.runs.filter((r) => r.role === "support");
  for (const r of support) {
    const run = rt.orchestrator.get(r.runId);
    console.log(`  also: ${r.pipeline} ${r.runId} ${run?.status ?? "missing"} (${r.label})`);
  }
  const disputes = await rt.rail.listDisputes();
  for (const id of result.doc.disputeIds) {
    const d = disputes.find((x) => x.id === id);
    console.log(`  dispute ${id}: ${d ? `${d.status}, ${d.reason}, capture ${d.transactionId}` : "not on the mock rail"}`);
  }
  const unfinished = result.rows.filter((r) => r.runStatus !== "done").length;
  const broken = result.rows.filter((r) => !r.chainOk).length;
  console.log("");
  console.log(`${result.rows.length - unfinished} of ${result.rows.length} runs finished; ${result.rows.length - broken} of ${result.rows.length} chains verified.`);
  if (!result.ok) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
