/**
 * Deterministic scam-phrase detectors (D2). Word-boundary regexes over untrusted text; one finding
 * per tactic, quoting the full line that matched. These run no matter what the model says, so a
 * hijacked model cannot hide them.
 */
import { DETECTOR_WEIGHTS, type TacticId } from "./taxonomy";
import { lines } from "./text";

export interface DetectorFinding {
  id: TacticId;
  /** The full line that matched, verbatim (trimmed). */
  quote: string;
  /** Which source the line came from. */
  source: DetectorSource;
}

export type DetectorSource = "chat" | "transcript" | "listing";

export const DETECTOR_RULES: { id: TacticId; patterns: RegExp[] }[] = [
  {
    id: "ff_request",
    patterns: [
      /\bfriends?\s*(?:and|&|n|'n')\s*family\b/i,
      /\bF\s?&\s?F\b/i,
      /\bFnF\b/i,
      /\bF and F\b/i,
    ],
  },
  {
    id: "gift_card_or_crypto",
    patterns: [/\bgift\s*-?\s*cards?\b/i, /\bbitcoin\b/i, /\bBTC\b/i, /\bcrypto(?:currency)?\b/i, /\bUSDT\b/i, /\bethereum\b/i],
  },
  {
    id: "advance_fee",
    patterns: [/\bdeposit\s+first\b/i, /\bholding\s+(?:deposit|fee)\b/i, /\bpay\s+(?:a|the)\s+deposit\b/i],
  },
  {
    // "\bwire\b" does not match "wireless" or "wired".
    id: "off_platform",
    patterns: [/\bwire(?:\s+transfer)?\b/i, /\bzelle\b/i],
  },
  {
    id: "urgency",
    patterns: [/\btoday\s+only\b/i],
  },
];

/**
 * Runs every rule over the sources in order (chat, transcript, listing) and returns the first
 * matching line per tactic.
 */
export function detect(sources: { source: DetectorSource; text: string | null | undefined }[]): DetectorFinding[] {
  const found = new Map<TacticId, DetectorFinding>();
  for (const rule of DETECTOR_RULES) {
    outer: for (const { source, text } of sources) {
      for (const line of lines(text)) {
        if (rule.patterns.some((re) => re.test(line))) {
          found.set(rule.id, { id: rule.id, quote: line, source });
          break outer;
        }
      }
    }
  }
  return DETECTOR_RULES.flatMap((r) => {
    const f = found.get(r.id);
    return f ? [f] : [];
  });
}

/** Deterministic score floor: capped sum of the weights of detector-found tactics. */
export function detectorFloor(findings: DetectorFinding[]): number {
  const ids = new Set(findings.map((f) => f.id));
  let sum = 0;
  for (const id of ids) sum += DETECTOR_WEIGHTS[id] ?? 0;
  return Math.min(100, sum);
}
