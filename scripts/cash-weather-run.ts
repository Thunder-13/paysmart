/**
 * Runs Cash Weather end to end in mock mode (no keys) and prints what happened.
 *   npx tsx scripts/cash-weather-run.ts
 */
import { createTestRuntime } from "../src/core/testing";
import { formatMoney, fromCents } from "../src/core/money";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "../src/pipelines/cash-weather/fixtures";
import type { CashWeatherState } from "../src/pipelines/cash-weather/types";

const usd = (cents: number) => formatMoney(fromCents(cents, "USD"));

async function main(): Promise<void> {
  const rt = createTestRuntime();
  let run = await rt.orchestrator.start("cash-weather", { packageJson: DEFAULT_PACKAGE_JSON, importCounts: DEFAULT_IMPORT_COUNTS });
  if (run.status === "waiting" && run.step === "send_nudges") run = await rt.orchestrator.resume(run.id, { approved: true });
  if (run.status === "waiting" && run.step === "pay") run = await rt.orchestrator.resume(run.id, { action: "sign" });
  const s = run.state as unknown as CashWeatherState;

  console.log(`Run ${run.id}: ${run.status}${run.error ? ` (${run.error})` : ""}, outcome ${s.outcome}`);
  for (const n of s.notices) console.log(`  notice: ${n.text}`);
  const f = s.forecast!;
  console.log(`\nWeather from ${f.asOf} (seed ${f.seed}, ${f.scenarios} scenarios):`);
  for (const w of f.weeks) {
    console.log(`  week ${String(w.week).padStart(2)} ${w.startDate}..${w.endDate}  ${w.label.padEnd(6)}  low p10 ${usd(w.lowP10Cents).padStart(11)}  low p50 ${usd(w.lowP50Cents).padStart(11)}`);
  }
  console.log(`\nNarrative (${s.narrative?.source}): ${s.narrative?.forecast}`);
  console.log("\nReminders:");
  for (const d of s.drafts) {
    const r = s.reminders.find((x) => x.invoiceId === d.invoiceId);
    console.log(`  ${d.number} ${d.payer.padEnd(18)} ${d.daysOverdue} days overdue  ${d.tone.padEnd(8)} -> ${r?.status ?? "pending"}`);
  }
  console.log("\nSafe to give:");
  for (const line of s.give?.lines ?? []) console.log(`  ${line}`);
  console.log("\nAllocation:");
  for (const p of s.give?.payouts ?? []) console.log(`  ${p.handle.padEnd(16)} ${(p.weightBps / 100).toFixed(2).padStart(6)}%  ${formatMoney(p.amount).padStart(8)}  ${p.email}`);
  for (const p of s.upstream?.packages.filter((x) => !x.route) ?? []) console.log(`  ${p.name}: no payout route`);
  console.log(`\nPayout: batch ${s.payout?.payoutBatchId ?? "none"}, ${s.payout?.status ?? "no status"}, verdict ${s.payout?.verdict?.decision ?? "none"}`);
  if (s.slipId) {
    const chain = rt.store.ledger.verifyChain(s.slipId);
    console.log(`Slip ${s.slipId}: ${rt.store.slips.get(s.slipId)?.status}, ledger ${rt.store.ledger.list(s.slipId).length} events, chain ${chain.ok ? "verified" : `broken at ${chain.brokenAtSeq}`}`);
  }
  if (run.status !== "done") process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
