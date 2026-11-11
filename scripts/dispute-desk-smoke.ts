/**
 * Dispute Desk smoke run, mock mode, no keys: builds three slip histories, seeds the three demo
 * scenarios, runs each dispute to the merchant review, confirms the recommended decision, and prints
 * the result. Exits 1 if any scenario lands on the wrong decision.
 *
 *   npx tsx scripts/dispute-desk-smoke.ts
 */
import { seedDemoDisputes } from "@/pipelines/dispute-desk/seed";
import { deskRuntime, notAsDescribedHistory, notReceivedHistory, resumeDesk, startDesk } from "@/pipelines/dispute-desk/testkit";

async function main(): Promise<void> {
  const rt = deskRuntime();
  const a = await notReceivedHistory(rt);
  const b = await notAsDescribedHistory(rt);
  const seeded = await seedDemoDisputes(rt, [
    { captureId: a.captureId, scenario: "not_received" },
    { captureId: b.captureId, scenario: "not_as_described" },
    { captureId: "CAP-SMOKE-UNLINKED", scenario: "unlinked" },
  ]);
  const expected = ["contest", "accept", "need_more"];
  let failures = 0;
  for (const [i, d] of seeded.created.entries()) {
    const run = await startDesk(rt, d.id);
    const rec = run.state.recommendation;
    if (run.status !== "waiting" || !rec || !run.state.draft) {
      console.log(`${d.id} | run ${run.status} | ${run.error ?? "no recommendation"}`);
      failures++;
      continue;
    }
    const signal = rec.decision === "need_more" ? { decision: "hold", notes: "" } : { decision: rec.decision, notes: run.state.draft.notes };
    const done = await resumeDesk(rt, run.id, signal);
    const o = done.state.outcome;
    console.log(
      [
        d.id,
        d.reason,
        `decision ${rec.decision} (${Math.round(rec.confidence * 100)}%)`,
        `cites ${rec.citedSeqs.map((s) => `#${s}`).join(" ") || "nothing"}`,
        `outcome ${o?.kind ?? "none"}`,
        `paypal ${o?.paypalStatus ?? "-"}`,
        `ledger ${o?.ledgerSeq !== null && o?.ledgerSeq !== undefined ? `#${o.ledgerSeq}` : "-"}`,
      ].join(" | "),
    );
    if (rec.decision !== expected[i]) {
      console.log(`  expected ${expected[i]}`);
      failures++;
    }
  }
  if (failures > 0) {
    console.log(`${failures} scenario(s) failed`);
    process.exit(1);
  }
  console.log("All three scenarios match.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
