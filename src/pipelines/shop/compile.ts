/**
 * Mandate compiler support for the shop pipeline: guidance for core.compileSlip, a deterministic
 * mock, and validation for the user's clause edits.
 */
import { z } from "zod";
import { ClauseSchema, type Clause, type CompiledSlip, type Money } from "@/core/contracts";
import { formatMoney, money, toCents } from "@/core/money";
import { nextSaturday, nextWeekday, weekdayIndex } from "./fixtures";

export const SHOP_CLAUSE_KINDS = ["budget_max", "quantity_max", "category_in", "deliver_by", "exclude_attribute", "expires_at"] as const;

export const SHOP_CATEGORIES = ["toy", "gift", "book", "game", "clothing", "gift_card"] as const;

/** Attributes the extractor fills; the compiler may only exclude on these. */
export const SHOP_ATTRIBUTES = ["power_source", "age_min", "material"] as const;

export const COMPILER_GUIDANCE = [
  `Use only these clause kinds: ${SHOP_CLAUSE_KINDS.join(", ")}. Put them in that order. Currency USD.`,
  `category_in uses only: ${SHOP_CATEGORIES.join(", ")}. A birthday present for a child is ["toy", "gift"].`,
  "exclude_attribute uses only attribute power_source (values battery, rechargeable, plug_in, wind_up, none), age_min (number) or material.",
  '"Nothing that needs batteries" becomes exclude_attribute power_source ["battery", "rechargeable"] with the label "Nothing that needs batteries".',
  '"A gift" or "one" means quantity_max 1 with the label "One gift".',
  '"By Saturday" (or another weekday) means the next such day after today, as deliver_by YYYY-MM-DD.',
  "expires_at is at most 72 hours from now.",
  'If the person names no amount, set budget and budget_max to "0.00"; the app will ask them for a limit.',
].join("\n");

const DAY_RE = /\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Pulls "$60", "60 dollars" or "60 usd" out of the intent; "0.00" when there is none. */
export function amountFromIntent(intent: string): Money {
  const m = /\$\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(intent) ?? /\b(\d{1,6}(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i.exec(intent);
  return money(m ? m[1] : "0");
}

/** Deterministic compiler mock: keyword rules that reproduce the demo slip (c1..c6). */
export function mockCompile(intent: string, now: Date): CompiledSlip {
  const budget = amountFromIntent(intent);
  const clauses: Clause[] = [];
  const extras: string[] = [];
  clauses.push({ id: "c1", kind: "budget_max", label: `Spend at most ${formatMoney(budget)}`, amount: budget });

  const one = /\b(a|one|1)\s+(\w+\s+)?(gift|present|toy|item)\b|\bgift\b|\bpresent\b/i.test(intent);
  if (one) clauses.push({ id: "c2", kind: "quantity_max", label: "One gift", count: 1 });
  const giftish = /\b(toy|gift|present|birthday|dinosaur|nephew|niece|kid|child)\b/i.test(intent);
  if (giftish) clauses.push({ id: "c3", kind: "category_in", label: "A toy or gift", categories: ["toy", "gift"] });
  const day = DAY_RE.exec(intent);
  if (day) {
    const idx = weekdayIndex(day[1]);
    const date = idx === 6 ? nextSaturday(now) : nextWeekday(now, idx);
    clauses.push({ id: "c4", kind: "deliver_by", label: `Arrives by ${capitalize(day[1])}`, date });
    extras.push(`arriving by ${capitalize(day[1])} ${date}`);
  }
  if (/batter/i.test(intent)) {
    clauses.push({
      id: "c5",
      kind: "exclude_attribute",
      label: "Nothing that needs batteries",
      attribute: "power_source",
      values: ["battery", "rechargeable"],
    });
    extras.push("with nothing that needs batteries");
  }
  const expiresAt = new Date(now.getTime() + 72 * 3_600_000).toISOString();
  clauses.push({ id: "c6", kind: "expires_at", label: "Ends in 72 hours", at: expiresAt });

  const what = `${one ? "One" : "Any"} ${giftish ? "toy or gift" : "item"}`;
  const limit = toCents(budget) > 0 ? ` for up to ${formatMoney(budget)}` : "";
  const summary = `${[`${what}${limit}`, ...extras].join(", ")}.${limit ? "" : " No spending limit yet; add one before signing."}`;
  return { clauses, budget, expiresAt, summary };
}

/** Why a slip can't be signed yet, or null when it can. */
export function slipProblem(clauses: Clause[], budget: Money): string | null {
  const budgets = clauses.filter((c) => c.kind === "budget_max");
  if (budgets.length !== 1) return "Keep exactly one spending limit on the slip.";
  if (toCents(budget) <= 0) return "Add a spending limit above $0.00 before signing (for example, change c1 to $60.00).";
  if (budget.currency !== "USD") return "Shop slips are in USD.";
  return null;
}

/** Attribute names the guard can actually check (the extractor fills them). */
export function uncheckableAttributes(clauses: Clause[]): string[] {
  return clauses
    .filter((c): c is Extract<Clause, { kind: "exclude_attribute" }> => c.kind === "exclude_attribute")
    .map((c) => c.attribute)
    .filter((a) => !(SHOP_ATTRIBUTES as readonly string[]).includes(a));
}

export type ClauseEditResult =
  | { ok: true; clauses: Clause[]; budget: Money; expiresAt: string | null; changed: boolean }
  | { ok: false; error: string };

/**
 * Checks clauses edited by the user. Exactly one positive USD budget_max, unique ids, valid
 * clause shapes. A budget_max whose amount changed gets a fresh label so it never quotes the old figure.
 */
export function validateClauseEdits(current: Clause[], edited: unknown): ClauseEditResult {
  const parsed = z.array(ClauseSchema).min(1).safeParse(edited);
  if (!parsed.success) {
    return { ok: false, error: `One of the clauses is malformed: ${parsed.error.issues[0]?.message ?? "invalid clause"}.` };
  }
  const ids = parsed.data.map((c) => c.id.trim());
  if (ids.some((id) => id === "") || new Set(ids).size !== ids.length) {
    return { ok: false, error: "Every clause needs its own id (c1, c2, ...)." };
  }
  const budgets = parsed.data.filter((c) => c.kind === "budget_max");
  if (budgets.length !== 1) return { ok: false, error: "Keep exactly one spending limit (budget_max)." };
  const budgetClause = budgets[0] as Extract<Clause, { kind: "budget_max" }>;
  const budget = { currency: budgetClause.amount.currency.toUpperCase(), value: budgetClause.amount.value };
  if (budget.currency !== "USD") return { ok: false, error: "Shop slips are in USD." };
  if (toCents(budget) <= 0) return { ok: false, error: "The spending limit has to be above $0.00." };
  const expiries = parsed.data.filter((c) => c.kind === "expires_at");
  if (expiries.length > 1) return { ok: false, error: "Keep at most one end time." };
  let expiresAt: string | null = null;
  if (expiries.length === 1) {
    const at = Date.parse((expiries[0] as Extract<Clause, { kind: "expires_at" }>).at);
    if (Number.isNaN(at)) return { ok: false, error: "The end time could not be read." };
    expiresAt = new Date(at).toISOString();
  }
  const clauses = parsed.data.map((c) => {
    if (c.kind !== "budget_max") return c;
    const before = current.find((x) => x.id === c.id && x.kind === "budget_max") as Extract<Clause, { kind: "budget_max" }> | undefined;
    const moved = !before || before.amount.value !== c.amount.value;
    return { ...c, amount: budget, label: moved ? `Spend at most ${formatMoney(budget)}` : c.label };
  });
  const changed = JSON.stringify(clauses) !== JSON.stringify(current);
  return { ok: true, clauses, budget, expiresAt, changed };
}
