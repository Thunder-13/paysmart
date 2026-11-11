/**
 * The Guard: compares a Proposal's facts with a Slip's clauses. Pure and deterministic.
 * No I/O, no LLM, no clock reads (time comes from ctx.now).
 *
 * decision = "outside" when any clause is violated, "ask" when nothing is violated but
 * a fact the slip depends on is unknown, otherwise "within".
 */
import {
  INTEGRITY_CLAUSE_ID,
  type Clause,
  type EvidenceKind,
  type FactValue,
  type GuardFn,
  type Money,
  type Proposal,
  type ProposalItem,
  type ProposalKind,
  type Slip,
  type Verdict,
} from "./contracts";
import { formatMoney, fromCents, toCents } from "./money";

type Violation = Verdict["violations"][number];
type Unknown = Verdict["unknowns"][number];

interface Acc {
  violations: Violation[];
  unknowns: Unknown[];
}

export const INTEGRITY_MESSAGE = "Listing text tried to give the agent instructions";

const MULTI_PACK_RE = /\b(\d+)[- ]?(pack|pcs|piece|count)\b/i;

/** Proposal kinds that move money toward someone (as opposed to bookkeeping kinds). */
const SPENDING_KINDS: ProposalKind[] = ["purchase", "payment", "payout", "metered_charge", "child_slip"];

const EVIDENCE_WORDS: Record<EvidenceKind, string> = {
  delivery_photo: "delivery photo",
  before_after_photos: "before and after photos",
  tracking: "tracking",
  work_product: "work product",
};

function q(title: string): string {
  return `"${title}"`;
}

function showFact(v: FactValue): string {
  return v === null ? "unknown" : String(v);
}

function sameFact(a: FactValue, b: FactValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }
  return a === b;
}

function safeCents(m: Money): number | null {
  try {
    return toCents(m);
  } catch {
    return null;
  }
}

function sameCurrency(a: Money, b: Money): boolean {
  return a.currency.toUpperCase() === b.currency.toUpperCase();
}

/** First 10 chars of an ISO date or datetime, or null when it does not look like one. */
function isoDay(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : null;
}

function payeeKeys(proposal: Proposal): string[] {
  const p = proposal.payee;
  if (!p) return [];
  return [p.email, p.merchantId].filter((x): x is string => !!x && x.trim() !== "").map((x) => x.trim().toLowerCase());
}

function payeeLabel(proposal: Proposal): string {
  const p = proposal.payee;
  return p?.email ?? p?.merchantId ?? p?.name ?? "the payee";
}

/**
 * Who a payout pays. settlePayout rebuilds payout items with facts.attributes.payee set to the
 * receiver email; fall back to proposal.payee when items carry no payee.
 */
export function payoutReceivers(proposal: Proposal): { key: string; label: string; cents: number }[] {
  const out = new Map<string, { key: string; label: string; cents: number }>();
  for (const item of proposal.items) {
    const payee = item.facts.attributes.payee;
    if (typeof payee !== "string" || payee.trim() === "") continue;
    const key = payee.trim().toLowerCase();
    const cents = (safeCents(item.unitPrice) ?? 0) * item.quantity;
    const prev = out.get(key);
    out.set(key, { key, label: payee.trim(), cents: (prev?.cents ?? 0) + cents });
  }
  if (out.size === 0) {
    const email = proposal.payee?.email ?? proposal.payee?.merchantId;
    if (email) out.set(email.trim().toLowerCase(), { key: email.trim().toLowerCase(), label: email, cents: safeCents(proposal.amount) ?? 0 });
  }
  return [...out.values()];
}

function checkBudget(c: Extract<Clause, { kind: "budget_max" }>, proposal: Proposal, spent: Money, acc: Acc): void {
  if (!SPENDING_KINDS.includes(proposal.kind)) return;
  if (!sameCurrency(proposal.amount, c.amount) || !sameCurrency(spent, c.amount)) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: the amount is in ${proposal.amount.currency}, but this slip is in ${c.amount.currency}.`,
    });
    return;
  }
  const limit = safeCents(c.amount);
  const used = safeCents(spent);
  const want = safeCents(proposal.amount);
  if (limit === null || used === null || want === null) {
    acc.violations.push({ clauseId: c.id, message: `${c.label}: the amount could not be read.` });
    return;
  }
  if (want + used > limit) {
    const left = Math.max(0, limit - used);
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: this needs ${formatMoney(proposal.amount)}, but only ${formatMoney(
        fromCents(left, c.amount.currency),
      )} of ${formatMoney(c.amount)} is left.`,
    });
  }
}

function checkQuantity(c: Extract<Clause, { kind: "quantity_max" }>, items: ProposalItem[], acc: Acc): void {
  if (items.length === 0) return;
  let total = 0;
  for (const item of items) {
    const perListing = item.facts.itemCount ?? 1;
    total += item.quantity * perListing;
    if (item.facts.itemCount === null && MULTI_PACK_RE.test(item.title)) {
      acc.unknowns.push({
        clauseId: c.id,
        field: "itemCount",
        message: `${c.label}: ${q(item.title)} looks like a multi-pack, but how many units it holds is unknown.`,
      });
    }
  }
  if (total > c.count) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: this adds up to ${total} units, and the limit is ${c.count}.`,
    });
  }
}

function checkCategory(c: Extract<Clause, { kind: "category_in" }>, items: ProposalItem[], acc: Acc): void {
  const allowed = c.categories.map((x) => x.trim().toLowerCase());
  for (const item of items) {
    const cat = item.facts.category;
    if (cat === null || cat.trim() === "") {
      acc.unknowns.push({
        clauseId: c.id,
        field: "category",
        message: `${c.label}: the category of ${q(item.title)} is unknown.`,
      });
    } else if (!allowed.includes(cat.trim().toLowerCase())) {
      acc.violations.push({
        clauseId: c.id,
        message: `${c.label}: ${q(item.title)} is ${cat}, which is not one of ${c.categories.join(", ")}.`,
      });
    }
  }
}

function checkDeliverBy(c: Extract<Clause, { kind: "deliver_by" }>, items: ProposalItem[], acc: Acc): void {
  const limit = isoDay(c.date);
  for (const item of items) {
    const est = item.facts.deliveryEstimate;
    const day = est ? isoDay(est) : null;
    if (!day || !limit) {
      acc.unknowns.push({
        clauseId: c.id,
        field: "deliveryEstimate",
        message: `${c.label}: there is no delivery date for ${q(item.title)}.`,
      });
    } else if (day > limit) {
      acc.violations.push({
        clauseId: c.id,
        message: `${c.label}: ${q(item.title)} arrives ${day}, after ${limit}.`,
      });
    }
  }
}

function checkExclude(c: Extract<Clause, { kind: "exclude_attribute" }>, items: ProposalItem[], acc: Acc): void {
  for (const item of items) {
    const has = Object.prototype.hasOwnProperty.call(item.facts.attributes, c.attribute);
    const value = has ? item.facts.attributes[c.attribute] : null;
    if (!has || value === null) {
      acc.unknowns.push({
        clauseId: c.id,
        field: `attributes.${c.attribute}`,
        message: `${c.label}: could not tell the ${c.attribute.replace(/_/g, " ")} of ${q(item.title)}.`,
      });
    } else if (c.values.some((v) => sameFact(v, value))) {
      acc.violations.push({
        clauseId: c.id,
        message: `${c.label}: ${q(item.title)} has ${c.attribute.replace(/_/g, " ")} ${showFact(value)}.`,
      });
    }
  }
}

function checkPayees(c: Extract<Clause, { kind: "payee_allowlist" }>, proposal: Proposal, acc: Acc): void {
  const allowedList = c.payees.map((p) => p.trim().toLowerCase());
  if (proposal.kind === "payout") {
    const receivers = payoutReceivers(proposal);
    if (receivers.length === 0) {
      acc.unknowns.push({ clauseId: c.id, field: "payee", message: `${c.label}: no payee is named.` });
    }
    for (const r of receivers) {
      if (!allowedList.includes(r.key)) {
        acc.violations.push({ clauseId: c.id, message: `${c.label}: ${r.label} is not on the list.` });
      }
    }
    return;
  }
  const keys = payeeKeys(proposal);
  if (keys.length === 0) {
    if (proposal.kind === "payment") {
      acc.unknowns.push({ clauseId: c.id, field: "payee", message: `${c.label}: no payee is named.` });
    }
    return;
  }
  if (!keys.some((k) => allowedList.includes(k))) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: ${payeeLabel(proposal)} is not on the list.`,
    });
  }
}

function checkEvidence(c: Extract<Clause, { kind: "require_evidence" }>, proposal: Proposal, acc: Acc): void {
  if (proposal.kind === "child_slip" || proposal.kind === "refund") return;
  const refs = proposal.evidence.filter((e) => e.kind === c.evidence);
  const words = EVIDENCE_WORDS[c.evidence];
  const failed = refs.find((e) => e.verdict === "fail");
  if (failed) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: the ${words} check failed${failed.detail ? ` (${failed.detail})` : ""}.`,
    });
    return;
  }
  if (!refs.some((e) => e.verdict === "pass")) {
    acc.unknowns.push({
      clauseId: c.id,
      field: `evidence.${c.evidence}`,
      message: `${c.label}: there is no passing ${words} yet.`,
    });
  }
}

function checkRateCard(c: Extract<Clause, { kind: "rate_card" }>, proposal: Proposal, acc: Acc): void {
  // A payout settles many metered fetches at once, so the per-fetch cap applies to metered charges, not payouts.
  if (proposal.kind === "payout" && c.unit === "fetch") return;
  const over = (m: Money): boolean => {
    if (!sameCurrency(m, c.price)) return true;
    const a = safeCents(m);
    const b = safeCents(c.price);
    return a === null || b === null || a > b;
  };
  if (proposal.items.length > 0) {
    for (const item of proposal.items) {
      if (over(item.unitPrice)) {
        acc.violations.push({
          clauseId: c.id,
          message: `${c.label}: ${q(item.title)} costs ${formatMoney(item.unitPrice)}, over ${formatMoney(c.price)} per ${c.unit}.`,
        });
      }
    }
  } else if (proposal.kind === "metered_charge" && over(proposal.amount)) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: this ${c.unit} costs ${formatMoney(proposal.amount)}, over ${formatMoney(c.price)}.`,
    });
  }
}

function checkSplit(c: Extract<Clause, { kind: "split_rule" }>, proposal: Proposal, acc: Acc): void {
  const sum = c.splits.reduce((s, x) => s + x.weightBps, 0);
  if (sum !== 10000) {
    acc.violations.push({
      clauseId: c.id,
      message: `${c.label}: the shares add up to ${(sum / 100).toFixed(2).replace(/\.00$/, "")}%, not 100%.`,
    });
  }
  if (proposal.kind === "payout") {
    const receivers = payoutReceivers(proposal);
    const total = receivers.reduce((s, r) => s + r.cents, 0);
    for (const r of receivers) {
      const share = c.splits.find((x) => x.payee.trim().toLowerCase() === r.key);
      if (!share) {
        acc.violations.push({ clauseId: c.id, message: `${c.label}: ${r.label} has no share in the split.` });
        continue;
      }
      const expected = Math.round((total * share.weightBps) / 10000);
      if (Math.abs(r.cents - expected) > 1) {
        acc.violations.push({
          clauseId: c.id,
          message: `${c.label}: ${r.label} should get ${formatMoney(fromCents(expected, proposal.amount.currency))} (${share.weightBps / 100}%), not ${formatMoney(fromCents(r.cents, proposal.amount.currency))}.`,
        });
      }
    }
  }
}

function checkExpiry(c: Extract<Clause, { kind: "expires_at" }>, proposal: Proposal, now: Date, acc: Acc): void {
  if (proposal.kind === "refund") return;
  const at = Date.parse(c.at);
  if (Number.isNaN(at)) {
    acc.unknowns.push({ clauseId: c.id, field: "expires_at", message: `${c.label}: the end date could not be read.` });
    return;
  }
  if (now.getTime() > at) {
    acc.violations.push({ clauseId: c.id, message: `${c.label}: this slip ran out at ${new Date(at).toISOString()}.` });
  }
}

/** Payout items are synthetic (one per receiver), so product-fact clauses do not apply to them. */
const ITEM_FACT_KINDS = new Set<Clause["kind"]>(["quantity_max", "category_in", "deliver_by", "exclude_attribute"]);

export const guard: GuardFn = (slip: Slip, proposal: Proposal, ctx) => {
  const acc: Acc = { violations: [], unknowns: [] };
  const items = proposal.items;

  if (items.some((i) => i.facts.injectionSuspected)) {
    acc.violations.push({ clauseId: INTEGRITY_CLAUSE_ID, message: INTEGRITY_MESSAGE });
  }

  for (const clause of slip.clauses) {
    if (proposal.kind === "payout" && ITEM_FACT_KINDS.has(clause.kind)) continue;
    switch (clause.kind) {
      case "budget_max":
        checkBudget(clause, proposal, ctx.spent, acc);
        break;
      case "quantity_max":
        checkQuantity(clause, items, acc);
        break;
      case "category_in":
        checkCategory(clause, items, acc);
        break;
      case "deliver_by":
        checkDeliverBy(clause, items, acc);
        break;
      case "exclude_attribute":
        checkExclude(clause, items, acc);
        break;
      case "payee_allowlist":
        checkPayees(clause, proposal, acc);
        break;
      case "require_evidence":
        checkEvidence(clause, proposal, acc);
        break;
      case "rate_card":
        checkRateCard(clause, proposal, acc);
        break;
      case "split_rule":
        checkSplit(clause, proposal, acc);
        break;
      case "expires_at":
        checkExpiry(clause, proposal, ctx.now, acc);
        break;
    }
  }

  const decision: Verdict["decision"] =
    acc.violations.length > 0 ? "outside" : acc.unknowns.length > 0 ? "ask" : "within";
  return { decision, violations: acc.violations, unknowns: acc.unknowns, checkedAt: ctx.now.toISOString() };
};

/** Merge several verdicts (e.g. one per payout receiver) into one, deduplicating lines. */
export function mergeVerdicts(verdicts: Verdict[], checkedAt: string): Verdict {
  const seenV = new Set<string>();
  const seenU = new Set<string>();
  const violations: Violation[] = [];
  const unknowns: Unknown[] = [];
  for (const v of verdicts) {
    for (const x of v.violations) {
      const k = `${x.clauseId}|${x.message}`;
      if (!seenV.has(k)) {
        seenV.add(k);
        violations.push(x);
      }
    }
    for (const x of v.unknowns) {
      const k = `${x.clauseId}|${x.field}|${x.message}`;
      if (!seenU.has(k)) {
        seenU.add(k);
        unknowns.push(x);
      }
    }
  }
  const decision: Verdict["decision"] = violations.length > 0 ? "outside" : unknowns.length > 0 ? "ask" : "within";
  return { decision, violations, unknowns, checkedAt };
}
