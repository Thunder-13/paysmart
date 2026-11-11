/**
 * Second Look smoke run: drives every mock path on an in-memory test runtime and prints one line per
 * outcome. Exits 1 if any path ends somewhere unexpected.
 *
 *   npx tsx scripts/second-look-smoke.ts
 */
import { createTestRuntime } from "@/core/testing";
import {
  approveToShipment,
  fixtureInput,
  protectedFlow,
  startToApproval,
  startToOffer,
  startToSeller,
  type SLRun,
} from "@/pipelines/second-look/demo-flows";
import secondLook from "@/pipelines/second-look";

function runtime() {
  return createTestRuntime({ pipelines: { "second-look": secondLook }, seedRail: false });
}

const paths: { name: string; expect: string; run: () => Promise<SLRun> }[] = [
  { name: "legit seller, protected payment, shipped", expect: "protected_shipped", run: () => protectedFlow(runtime(), fixtureInput("legit")) },
  {
    name: "scam seller refuses the honest offer",
    expect: "seller_refused",
    run: async () => {
      const rt = runtime();
      const seller = await startToSeller(rt, fixtureInput("scam"));
      return (await rt.orchestrator.resume(seller.id, { response: "refused" })) as SLRun;
    },
  },
  {
    name: "seller asks to be paid at another email",
    expect: "payee_blocked",
    run: async () => {
      const rt = runtime();
      const seller = await startToSeller(rt, fixtureInput("borderline"));
      return (await rt.orchestrator.resume(seller.id, { response: "accepted", payeeEmail: "pay.my.cousin@example.net" })) as SLRun;
    },
  },
  {
    name: "buyer walks away after the risk card",
    expect: "buyer_walked_away",
    run: async () => {
      const rt = runtime();
      const offer = await startToOffer(rt, fixtureInput("scam"));
      return (await rt.orchestrator.resume(offer.id, { action: "walk_away" })) as SLRun;
    },
  },
  {
    name: "paid, item never arrived, handed to Dispute Desk",
    expect: "handed_off",
    run: async () => {
      const rt = runtime();
      const shipment = await approveToShipment(rt, await startToApproval(rt, fixtureInput("legit")));
      return (await rt.orchestrator.resume(shipment.id, { event: "not_arrived" })) as SLRun;
    },
  },
];

async function main() {
  let failed = 0;
  for (const p of paths) {
    try {
      const run = await p.run();
      const outcome = run.state.outcome ?? `(${run.status}${run.error ? `: ${run.error}` : ""})`;
      const ok = run.status === "done" && outcome === p.expect;
      if (!ok) failed += 1;
      const risk = run.state.analysis ? `risk ${run.state.analysis.riskScore}/100 ${run.state.analysis.band}` : "no analysis";
      console.log(`${ok ? "ok  " : "FAIL"} ${outcome.padEnd(18)} ${risk.padEnd(20)} ${p.name}`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${"(threw)".padEnd(18)} ${"".padEnd(20)} ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(failed === 0 ? `\nAll ${paths.length} Second Look paths finished as expected.` : `\n${failed} path(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
