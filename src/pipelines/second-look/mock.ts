/**
 * Deterministic stand-in for the model (D5). A chat that contains a fixture's chat gets that
 * fixture's scripted analysis (so fixture + injected lines still maps to the same result).
 * Anything else gets a keyword heuristic over the same text.
 */
import { detect, detectorFloor } from "./detectors";
import { FIXTURES, FIXTURE_IDS, type Fixture } from "./fixtures";
import { deterministicCard } from "./offer";
import { bandOf, type TacticId } from "./taxonomy";
import { lines, normalize } from "./text";
import type { ModelAnalysis } from "./types";

/** Keyword rules for the tactics the phrase detectors leave to the model. */
const MODEL_ONLY_RULES: { id: TacticId; re: RegExp; why: string }[] = [
  {
    id: "ship_only",
    re: /\b(can'?t|cannot|won'?t|unable to) meet\b|\bship(?:ping)? only\b|\bonly (?:ship|transfer)\b|\bout of town\b/i,
    why: "The seller will not meet or show the item.",
  },
  {
    id: "too_good_price",
    re: /\b(?:below|under) (?:face value|retail|market)\b|\bhalf (?:the )?price\b|\bpriced to sell fast\b/i,
    why: "The price is far below what this usually sells for.",
  },
  {
    id: "overpayment",
    re: /\boverpa(?:y|id|yment)\b|\b(?:send|pay) (?:you )?extra\b|\brefund (?:me )?the difference\b/i,
    why: "Overpaying and asking for change back is a known trick.",
  },
  {
    id: "identity_mismatch",
    re: /\b(?:my|his|her) (?:cousin|wife|husband|brother|sister|friend|partner|business)(?:'s)? (?:account|email|paypal)\b|\bpay (?:to )?(?:this|another|a different) (?:email|account)\b/i,
    why: "The money would go to someone other than the seller.",
  },
  {
    id: "refuses_protection",
    re: /\bno (?:goods and services|g&s)\b|\b(?:don'?t|do not|won'?t) (?:use|send|do) (?:goods|g&s)\b|\bskip the fees?\b|\bavoid (?:the )?fees?\b/i,
    why: "The seller wants to avoid buyer protection.",
  },
  {
    id: "urgency",
    re: /\bright now\b|\basap\b|\bfirst come\b|\bother (?:people|buyers)\b|\bsomeone else\b/i,
    why: "Pressure to pay before you can check.",
  },
  {
    id: "off_platform",
    re: /\bwhatsapp\b|\btelegram\b|\btext me at\b|\bcash ?app\b|\bvenmo\b/i,
    why: "The seller wants to move off the marketplace.",
  },
];

export function matchFixture(chatText: string | null | undefined): Fixture | null {
  if (!chatText) return null;
  const chat = normalize(chatText);
  for (const id of FIXTURE_IDS) {
    const f = FIXTURES[id];
    if (chat.includes(normalize(f.chatText))) return f;
  }
  return null;
}

/** Keyword heuristic for text that is not a fixture. */
export function heuristicAnalysis(texts: (string | null | undefined)[]): Omit<ModelAnalysis, "transcript"> {
  const findings = detect(texts.map((text) => ({ source: "chat" as const, text })));
  const tactics: ModelAnalysis["tactics"] = findings.map((f) => ({ id: f.id, quote: f.quote, why: "Matched a known scam phrase." }));
  const seen = new Set<TacticId>(tactics.map((t) => t.id));
  let extra = 0;
  for (const rule of MODEL_ONLY_RULES) {
    if (seen.has(rule.id)) continue;
    const line = texts.flatMap((t) => lines(t)).find((l) => rule.re.test(l));
    if (!line) continue;
    tactics.push({ id: rule.id, quote: line, why: rule.why });
    seen.add(rule.id);
    extra += 1;
  }
  const riskScore = Math.min(100, detectorFloor(findings) + 12 * extra + (tactics.length === 0 ? 5 : 0));
  const card = deterministicCard(tactics, bandOf(riskScore));
  return { tactics, riskScore, ...card };
}

export function mockAnalysis(input: {
  chatText: string | null | undefined;
  listingText: string;
  hasImage: boolean;
}): ModelAnalysis {
  const fixture = matchFixture(input.chatText);
  if (fixture) return { ...fixture.script, transcript: null };
  if (input.hasImage && !input.chatText) {
    // Mock mode cannot read pixels: it pretends the screenshot shows the scam sample chat.
    return { ...FIXTURES.scam.script, transcript: FIXTURES.scam.chatText };
  }
  return { ...heuristicAnalysis([input.chatText, input.listingText]), transcript: null };
}
