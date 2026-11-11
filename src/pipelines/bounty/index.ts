/**
 * Bounty Board. One pipeline, 2 run kinds picked by input.kind:
 *   bounty  route -> draft -> funding -> claim -> verify -> settle -> receipt   (close on deadline/cancel)
 *   pledge  route -> pledge_start -> pledge_signed
 * See openspec/changes/add-bounty-pipeline/design.md for the step graph and calls per step.
 */
import type { PipelineDefinition } from "@/core/contracts";
import { BountyPipelineInputSchema, initialState, type BountyPipelineInput, type BountyState } from "./schema";
import { claim, draft, funding, route, verify } from "./steps/lifecycle";
import { pledgeSigned, pledgeStart } from "./steps/pledge";
import { close, receipt, settle } from "./steps/settle";

export const BOUNTY_TITLE = "Bounty Board";
export const BOUNTY_TAGLINE =
  "Neighbors pool money for a small job. PayPal holds each pledge until before and after photos pass, then Payouts pays the worker.";
export const BOUNTY_PRIMITIVES = ["Orders v2 AUTHORIZE", "Payments v2 capture", "Payments v2 void", "Payouts v1", "Claude vision", "Perceptual hash"];

const definition: PipelineDefinition<BountyPipelineInput, BountyState> = {
  id: "bounty",
  title: BOUNTY_TITLE,
  tagline: BOUNTY_TAGLINE,
  primitives: BOUNTY_PRIMITIVES,
  input: BountyPipelineInputSchema,
  initialState,
  firstStep: "route",
  steps: {
    route,
    draft,
    funding,
    claim,
    verify,
    settle,
    receipt,
    close,
    pledge_start: pledgeStart,
    pledge_signed: pledgeSigned,
  },
};

export default definition;
