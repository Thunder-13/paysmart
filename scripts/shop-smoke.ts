/**
 * Runs the shop pipeline end to end in mock mode (no keys) and prints the ledger and totals.
 *
 *   npx tsx scripts/shop-smoke.ts --red-team            hero run: 2 options, 1 ruled out; picks option 1: Captured 42.18, Released 17.82
 *   npx tsx scripts/shop-smoke.ts --red-team --helper   helper run: Captured 45.18, Released 14.82
 */
import type { Run } from "@/core/contracts";
import { describeEvent } from "@/components/event-text";
import { formatMoney } from "@/core/money";
import { createTestRuntime } from "@/core/testing";
import { createShopPipeline } from "@/pipelines/shop";
import type { RuledOut, ShopOption, ShopState } from "@/pipelines/shop/types";

const args = new Set(process.argv.slice(2));
const redTeam = args.has("--red-team");
const hireHelper = args.has("--helper");

function expectStep(run: Run, step: string): void {
  if (run.status !== "waiting" || run.step !== step) {
    throw new Error(`Expected to wait at ${step}, got ${run.status} at ${run.step}${run.error ? `: ${run.error}` : ""}`);
  }
}

async function main(): Promise<void> {
  const rt = createTestRuntime({
    seedRail: false,
    pipelines: { shop: createShopPipeline({ channel3ApiKey: () => null }) },
  });
  let run = await rt.orchestrator.start("shop", { redTeam, hireHelper });
  expectStep(run, "confirm_slip");
  run = await rt.orchestrator.resume(run.id, { approved: true });
  expectStep(run, "complete_signing");
  const orderId = String((run.wait?.data as { orderId: string }).orderId);
  rt.mockRail.approveOrder(orderId, "buyer@example.com");
  run = await rt.orchestrator.resume(run.id, { approved: true, orderId });
  expectStep(run, "confirm_cart");
  const wait = run.wait?.data as { options: ShopOption[]; ruledOut: RuledOut[]; selectedOptionId: string };
  console.log(`Options (${wait.options.length}), selected ${wait.selectedOptionId}`);
  for (const o of wait.options) {
    console.log(`  ${o.id} #${o.rank} ${o.verdict.decision.padEnd(6)} ${formatMoney(o.proposal.amount).padStart(7)}  ${o.lines.map((l) => l.title).join(" + ")}`);
  }
  console.log(`Ruled out (${wait.ruledOut.length})`);
  for (const r of wait.ruledOut) console.log(`  ${formatMoney(r.amount).padStart(8)}  ${r.title}  broke ${r.clauseIds.join(", ")}`);
  const pick = wait.options[0];
  if (!pick) throw new Error("The agent offered no options.");
  run = await rt.orchestrator.resume(run.id, { approved: true, optionId: pick.id, via: "voice" });
  expectStep(run, "verify_delivery");
  run = await rt.orchestrator.resume(run.id, { sample: true });
  if (run.status !== "done") throw new Error(`Run ended ${run.status}: ${run.error ?? ""}`);

  const slipId = run.slipId!;
  console.log(`Shop smoke run (red-team ${redTeam ? "on" : "off"}, helper ${hireHelper ? "on" : "off"})  slip ${slipId}`);
  for (const e of rt.store.ledger.list(slipId)) {
    const { title, detail } = describeEvent(e);
    console.log(`  #${String(e.seq).padStart(2, " ")} ${e.actor.padEnd(6)} ${e.type.padEnd(24)} ${title}${detail ? ` · ${detail}` : ""}`);
  }
  for (const child of rt.store.slips.list({ parentId: slipId })) {
    console.log(`  helper slip ${child.id}: ${child.status}, spent ${formatMoney(child.spent)}`);
  }
  const s = run.state as unknown as ShopState;
  const t = s.totals!;
  console.log(`Outcome ${s.outcome}`);
  console.log(`Held ${t.held.value}  Captured ${t.captured.value}  Released ${t.released.value}  Refunded ${t.refunded.value}`);
  console.log(`Chain verified: ${rt.store.ledger.verifyChain(slipId).ok}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
