/**
 * Deadline sweep for the bounty board. Resumes every waiting bounty run with {event: "tick"}, so
 * bounties past their deadline close and PayPal voids their pledge holds.
 *
 *   npx tsx scripts/bounty-tick.ts
 *
 * Uses the same env as the app (DATA_DIR, PAYPAL_*, ANTHROPIC_API_KEY). Safe to run on a schedule.
 */
import { tickAll } from "../src/pipelines/bounty/tick";
import { getRuntime } from "../src/server/runtime";

async function main() {
  const { resumed, closed } = await tickAll(getRuntime());
  console.log(`bounty tick: ${resumed} waiting bounty run${resumed === 1 ? "" : "s"} checked, ${closed.length} closed${closed.length ? ` (${closed.join(", ")})` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
