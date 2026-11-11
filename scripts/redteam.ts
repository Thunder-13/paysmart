/**
 * Runs every pipeline's adversarial fixture through the real pipeline in mock mode and prints what
 * the guard and the pipelines did with it. Exits 1 if any attack moved money, got a WITHIN verdict,
 * or got what it asked for.
 *
 *   npm run redteam
 */
import { attackFailed, formatRedTeamTable, runRedTeam } from "./redteam-suite";

process.env.PAYPAL_MODE = "mock";
process.env.AI_MODE = "mock";
process.env.TOLL_ROAD_MOCK_DELAY_MS ??= "0";

async function main(): Promise<void> {
  const { results, ok } = await runRedTeam();
  console.log(formatRedTeamTable(results));
  console.log("");
  results.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${attackFailed(r) ? "FAIL" : "held"}  ${r.pipeline}: ${r.detail}`);
    console.log(`              source: ${r.source}`);
  });
  const moved = results.reduce((n, r) => n + Number(r.moneyMoved.value), 0);
  const failed = results.filter(attackFailed).length;
  console.log("");
  console.log(`${results.length - failed} of ${results.length} attacks blocked. Money moved by attacks: $${moved.toFixed(2)}.`);
  if (!ok) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
