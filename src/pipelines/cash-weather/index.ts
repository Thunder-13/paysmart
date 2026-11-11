/**
 * Cash Weather (ideas 5 + 9): forecast 90 days from PayPal transactions and invoices, chase late
 * invoices with reminders Ana approves, then pay the open-source maintainers her code depends on
 * under a guarded patronage slip.
 *
 *   seed -> ingest -> forecast -> narrate -> upstream -> budget -> draft_slip -> nudges
 *     [WAIT user_confirm, resume send_nudges] -> confirm_slip [WAIT user_confirm, resume pay]
 *     -> pay -> payout_status -> done
 */
import type { PipelineDefinition } from "@/core/contracts";
import { CashWeatherInputSchema, type CashWeatherInput, type CashWeatherState } from "./types";
import { ingestStep, seedStep } from "./steps/ingest";
import { budgetStep, forecastStep, narrateStep, upstreamStep } from "./steps/plan";
import { draftSlipStep } from "./steps/slip";
import { nudgesStep, sendNudgesStep } from "./steps/nudges";
import { confirmSlipStep, payoutStatusStep, payStep } from "./steps/pay";

export function initialState(input: CashWeatherInput): CashWeatherState {
  return {
    input,
    asOf: null,
    notices: [],
    sources: { transactions: null, invoices: null },
    transactions: [],
    invoices: [],
    forecast: null,
    narrative: null,
    upstream: null,
    give: null,
    drafts: [],
    reminders: [],
    slipId: null,
    payout: null,
    outcome: null,
    waitError: null,
  };
}

const definition: PipelineDefinition<CashWeatherInput, CashWeatherState> = {
  id: "cash-weather",
  title: "Cash Weather",
  tagline: "Know what's coming in, then pay who you depend on.",
  primitives: [
    "PayPal transaction search",
    "PayPal Invoicing reminders",
    "PayPal Payouts",
    "Claude forecast narrative",
    "Claude reminder drafts",
    "Seeded 500-scenario forecast",
    "npm registry",
  ],
  input: CashWeatherInputSchema,
  initialState,
  firstStep: "seed",
  steps: {
    seed: seedStep,
    ingest: ingestStep,
    forecast: forecastStep,
    narrate: narrateStep,
    upstream: upstreamStep,
    budget: budgetStep,
    draft_slip: draftSlipStep,
    nudges: nudgesStep,
    send_nudges: sendNudgesStep,
    confirm_slip: confirmSlipStep,
    pay: payStep,
    payout_status: payoutStatusStep,
  },
};

export default definition;
