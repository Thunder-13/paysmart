/**
 * Compile support for PaySmart: guidance for core.compileSlip, a deterministic mock, and the
 * request screen that runs on the compiled slip before any search.
 */
import type { Clause, CompiledSlip, Money } from "@/core/contracts";
import { cmpMoney, formatMoney, money, toCents } from "@/core/money";
import { nextSaturday, nextWeekday, weekdayIndex } from "@/pipelines/shop/fixtures";
import { slipProblem } from "@/pipelines/shop/compile";
import { detect } from "@/pipelines/second-look/detectors";
import { TACTIC_LABELS } from "@/pipelines/second-look/taxonomy";
import { PAYSMART_MAX_LIMIT, type Need, type ScreenResult } from "./types";

export const PAYSMART_CLAUSE_KINDS = ["budget_max", "quantity_max", "category_in", "deliver_by", "exclude_attribute", "expires_at"] as const;
export const PAYSMART_CATEGORIES = ["toy", "gift", "book", "game", "clothing", "greeting_card", "party_supplies", "home", "electronics", "gift_card"] as const;

export const PAYSMART_GUIDANCE = [
  `Use only these clause kinds: ${PAYSMART_CLAUSE_KINDS.join(", ")}. Put them in that order. Currency USD.`,
  `category_in uses only: ${PAYSMART_CATEGORIES.join(", ")}. Include a category for every thing the person needs (a birthday card is greeting_card, a child's present is toy and gift). Never include gift_card unless they ask for a gift card.`,
  "quantity_max is the total number of units across the whole basket, so one gift plus one card is 2. A 4-pack counts as 4.",
  "exclude_attribute uses only attribute power_source (values battery, rechargeable, plug_in, wind_up, none), age_min (number) or material.",
  '"Nothing that needs batteries" becomes exclude_attribute power_source ["battery", "rechargeable"] with the label "Nothing that needs batteries".',
  '"By Saturday" (or another weekday) means the next such day after today, as deliver_by YYYY-MM-DD.',
  "expires_at is at most 72 hours from now.",
  'If the person names no amount, set budget and budget_max to "0.00"; the app will ask them for a limit.',
].join("\n");

const DAY_RE = /\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "$60", "60 dollars", or a last line that is only a number (an answer to "how much?"). "0.00" when none. */
export function amountFromAsk(text: string): Money {
  const m =
    /\$\s*(\d{1,3}(?:,\d{3})+|\d{1,6})(\.\d{1,2})?/.exec(text) ??
    /\b(\d{1,3}(?:,\d{3})+|\d{1,6})(\.\d{1,2})?\s*(?:dollars|usd|bucks)\b/i.exec(text) ??
    /(?:^|\n)\s*(\d{1,3}(?:,\d{3})+|\d{1,6})(\.\d{1,2})?\s*$/.exec(text);
  return money(m ? `${m[1].replace(/,/g, "")}${m[2] ?? ""}` : "0");
}

function categoriesFor(needs: Need[]): string[] {
  const out = new Set<string>();
  for (const n of needs) {
    const t = `${n.need} ${n.query}`.toLowerCase();
    if (/gift card/.test(t)) out.add("gift_card");
    else if (/\bcards?\b/.test(t)) out.add("greeting_card");
    else if (/book/.test(t)) out.add("book");
    else if (/\bgame/.test(t)) out.add("game");
    else if (/shirt|jacket|sock|hat|clothing|dress/.test(t)) out.add("clothing");
    else if (/party|balloon/.test(t)) out.add("party_supplies");
    else if (/lamp|towel|kitchen|home|kettle/.test(t)) out.add("home");
    else if (/charger|cable|headphone|speaker|electronic/.test(t)) out.add("electronics");
    else {
      out.add("toy");
      out.add("gift");
    }
  }
  return out.size ? [...out] : ["toy", "gift"];
}

/** Deterministic compiler mock: budget, basket size, categories, weekday and battery rules from the ask. */
export function mockCompile(text: string, needs: Need[], now: Date): CompiledSlip {
  const budget = amountFromAsk(text);
  const clauses: Clause[] = [{ id: "c1", kind: "budget_max", label: `Spend at most ${formatMoney(budget)}`, amount: budget }];
  const extras: string[] = [];
  const units = needs.reduce((s, n) => s + n.quantity, 0) || 1;
  clauses.push({ id: "c2", kind: "quantity_max", label: units === 1 ? "One item" : `${units} items at most`, count: units });
  const categories = categoriesFor(needs);
  clauses.push({ id: "c3", kind: "category_in", label: `Only ${categories.join(", ").replace(/_/g, " ")}`, categories });
  const day = DAY_RE.exec(text);
  if (day) {
    const idx = weekdayIndex(day[1]);
    const date = idx === 6 ? nextSaturday(now) : nextWeekday(now, idx);
    clauses.push({ id: "c4", kind: "deliver_by", label: `Arrives by ${capitalize(day[1])}`, date });
    extras.push(`arriving by ${capitalize(day[1])} ${date}`);
  }
  if (/\b(?:no|without|nothing (?:that )?(?:needs?|uses?|takes?|with))\b[^.]*batter/i.test(text)) {
    clauses.push({ id: "c5", kind: "exclude_attribute", label: "Nothing that needs batteries", attribute: "power_source", values: ["battery", "rechargeable"] });
    extras.push("with nothing that needs batteries");
  }
  const expiresAt = new Date(now.getTime() + 72 * 3_600_000).toISOString();
  clauses.push({ id: "c6", kind: "expires_at", label: "Ends in 72 hours", at: expiresAt });
  const what = needs.map((n) => n.need).join(" and ") || "your items";
  const limit = toCents(budget) > 0 ? ` for up to ${formatMoney(budget)}` : "";
  const summary = `${[`${what}${limit}`, ...extras].join(", ")}.${limit ? "" : " No spending limit yet."}`;
  return { clauses, budget, expiresAt, summary };
}

function result(status: ScreenResult["status"], reason: string): ScreenResult {
  return { screen: "request", status, reason, clauseIds: [], quote: null };
}

/**
 * Request screen. Returns one result per rule and, when the ask cannot go on, the question to put
 * to the person. Runs before any search, so a bad ask moves no money and costs no scraping.
 */
export function requestScreens(args: { clauses: Clause[]; budget: Money; ask: string; now: Date }): { results: ScreenResult[]; question: string | null } {
  const results: ScreenResult[] = [];
  let question: string | null = null;
  const stop = (reason: string, q: string) => {
    results.push(result("fail", reason));
    question ??= q;
  };

  const problem = slipProblem(args.clauses, args.budget);
  if (problem) stop(problem, toCents(args.budget) <= 0 ? "How much can you spend in total?" : problem);
  else results.push(result("pass", "The ask became a valid slip"));

  const budgetClause = args.clauses.find((c): c is Extract<Clause, { kind: "budget_max" }> => c.kind === "budget_max");
  if (!budgetClause) {
    stop("The slip has no spending limit", "What is your limit?");
  } else if (cmpMoney(budgetClause.amount, PAYSMART_MAX_LIMIT) > 0) {
    stop(
      `The limit ${formatMoney(budgetClause.amount)} is over the cap`,
      `PaySmart caps one ask at ${formatMoney(PAYSMART_MAX_LIMIT)} in this build. What is your limit?`,
    );
  } else {
    results.push(result("pass", `Limit ${formatMoney(budgetClause.amount)} is within the ${formatMoney(PAYSMART_MAX_LIMIT)} cap`));
  }

  const expiry = args.clauses.find((c): c is Extract<Clause, { kind: "expires_at" }> => c.kind === "expires_at");
  results.push(result("pass", expiry ? `The slip ends ${expiry.at.slice(0, 16).replace("T", " ")} UTC, inside PayPal's 29-day authorization window` : "The slip expires inside 29 days"));

  const cat = args.clauses.find((c): c is Extract<Clause, { kind: "category_in" }> => c.kind === "category_in");
  if (!cat) {
    stop("The slip does not say what kind of thing to buy", "What kind of thing are you shopping for?");
  } else if (cat.categories.some((c) => c.toLowerCase() === "gift_card") && !/gift\s*-?\s*cards?/i.test(args.ask)) {
    stop("The slip would let the agent buy gift cards, and the ask never mentions one", "I read this as allowing gift cards, which you did not ask for. What do you want to buy?");
  } else {
    results.push(result("pass", "The categories match what you asked for"));
  }

  const flags = detect([{ source: "chat", text: args.ask }]);
  results.push(
    result(
      "pass",
      flags.length
        ? `Second Look noted: ${flags.map((f) => TACTIC_LABELS[f.id]).join(", ")}. Every seller is still screened.`
        : "Second Look found no payment red flags in your ask",
    ),
  );
  return { results, question };
}
