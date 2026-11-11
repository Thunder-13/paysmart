/** The payment slip (D1) and the pre-payment proposal (D6). Built in code, no AI involved. */
import type { NewProposal, NewSlip } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { CLAUSE_IDS, SLIP_HOURS } from "./taxonomy";
import type { Analysis, SecondLookInput } from "./types";

export function buildSlip(input: SecondLookInput, opts: { now: Date; listingTitle: string; analysis: Analysis | null }): NewSlip {
  const expiresAt = new Date(opts.now.getTime() + SLIP_HOURS * 3600_000).toISOString();
  const seller = input.sellerEmail.trim().toLowerCase();
  return {
    pipeline: "second-look",
    principal: input.principal,
    intent: `Pay ${seller} ${formatMoney(input.amount)} for "${opts.listingTitle}", only as a protected goods payment.`,
    clauses: [
      { id: CLAUSE_IDS.payee, kind: "payee_allowlist", label: `Only pay ${seller}`, payees: [seller] },
      { id: CLAUSE_IDS.budget, kind: "budget_max", label: `No more than ${formatMoney(input.amount)}`, amount: input.amount },
      {
        id: CLAUSE_IDS.evidence,
        kind: "require_evidence",
        label: "Seller ships with a tracking number",
        evidence: "tracking",
        rubric: "The seller provides a carrier tracking number after the protected payment.",
      },
      { id: CLAUSE_IDS.expiry, kind: "expires_at", label: `Pay within ${SLIP_HOURS} hours`, at: expiresAt },
    ],
    budget: input.amount,
    expiresAt,
    meta: {
      listingTitle: opts.listingTitle,
      sellerEmail: seller,
      riskScore: opts.analysis?.riskScore ?? null,
      band: opts.analysis?.band ?? null,
      tactics: opts.analysis?.tactics.map((t) => t.id) ?? [],
    },
  };
}

/**
 * The payment the guard checks before any order exists. Facts come from what the buyer typed, so
 * injectionSuspected stays false (D7); tracking is pending because it only exists after payment.
 */
export function buildPaymentProposal(input: SecondLookInput, opts: { slipId: string; listingTitle: string; payeeEmail: string }): NewProposal {
  return {
    slipId: opts.slipId,
    kind: "payment",
    amount: input.amount,
    payee: { email: opts.payeeEmail.trim().toLowerCase(), merchantId: null, name: null },
    items: [
      {
        title: opts.listingTitle,
        quantity: 1,
        unitPrice: input.amount,
        facts: {
          category: null,
          inStock: null,
          deliveryEstimate: null,
          itemCount: 1,
          attributes: {},
          injectionSuspected: false,
        },
        sourceUrl: null,
      },
    ],
    evidence: [{ kind: "tracking", verdict: "unknown", detail: "Pending until the seller ships.", ref: null }],
    rationale: "The buyer chose a protected goods payment after the seller accepted the honest offer.",
  };
}
