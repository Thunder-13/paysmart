/**
 * Dispute Desk: the merchant side of the trust layer. Links a PayPal dispute to the slip behind it,
 * verifies the hash chain, recommends contest / accept / need_more with cited ledger events, and
 * sends the merchant-approved response with provide-evidence or accept-claim.
 */
import type { PipelineDefinition } from "@/core/contracts";
import { STEPS } from "./steps";
import { DisputeDeskInputSchema, initialState, type DisputeDeskInput, type DisputeDeskState } from "./types";

const definition: PipelineDefinition<DisputeDeskInput, DisputeDeskState> = {
  id: "dispute-desk",
  title: "Dispute Desk",
  tagline: "Answer a PayPal dispute with evidence the slip already holds, and an honest call on whether to fight it.",
  primitives: [
    "Disputes API: show, provide evidence, accept claim",
    "Hash-chained evidence pack",
    "Quarantined buyer text",
    "AI triage with cited ledger events",
  ],
  input: DisputeDeskInputSchema,
  initialState,
  firstStep: "load",
  steps: STEPS,
};

export default definition;
export { seedDemoDisputes, ensureFixtureDisputes, DEMO_SCENARIOS, type DemoLink, type DemoScenario, type SeedResult } from "./seed";
