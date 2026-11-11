/**
 * Offline smoke run of the whole bounty lifecycle: mock PayPal, mock AI, in-memory store.
 * 2 backers pledge 25.00 + 15.00, Dana claims, the passing fixture photos go in, Dana is paid 40.00.
 *
 *   npx tsx scripts/bounty-smoke.ts
 */
import { describeEvent } from "../src/components/event-text";
import { formatMoney } from "../src/core/money";
import { PASSING_PAIR } from "../src/pipelines/bounty/fixtures";
import { makeKit } from "../src/pipelines/bounty/testkit";

async function main() {
  const kit = makeKit();
  const { bountyId } = await kit.fundedAndClaimed();
  await kit.prove(bountyId, PASSING_PAIR);
  const bounty = kit.bounty(bountyId);

  console.log(`Bounty "${bounty.title}" is ${bounty.status}.`);
  console.log("\nPool slip ledger:");
  for (const e of kit.rt.store.ledger.list(bounty.payoutSlipId)) {
    if (e.type.startsWith("run.")) continue;
    const { title, detail } = describeEvent(e);
    console.log(`  #${String(e.seq).padStart(2)} ${e.type.padEnd(22)} ${title}${detail ? ` · ${detail}` : ""}`);
  }
  const chain = kit.rt.store.ledger.verifyChain(bounty.payoutSlipId);
  console.log(`\nChain verifies: ${chain.ok}`);
  if (bounty.payout) {
    console.log(`\nReceipt: ${formatMoney(bounty.payout.amount)} to ${bounty.payout.receiverEmail}, batch ${bounty.payout.batchId} (${bounty.payout.status})`);
    for (const c of bounty.captures) console.log(`  ${c.backer} charged ${formatMoney(c.amount)} (capture ${c.captureId})`);
  }
  if (bounty.status !== "paid" || !chain.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
