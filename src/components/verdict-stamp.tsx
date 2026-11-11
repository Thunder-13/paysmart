import type { CSSProperties } from "react";
import type { Verdict } from "@/core/contracts";

/** The strip's holder colour per decision. Red belongs to refusal alone. */
const LOOK: Record<Verdict["decision"], { word: string; holder: string; ink: string; edge: string }> = {
  within: { word: "WITHIN SLIP", holder: "bg-pp-sky", ink: "text-night", edge: "border-pp-sky" },
  outside: { word: "OUTSIDE SLIP", holder: "bg-stamp-red", ink: "text-on-plate", edge: "border-stamp-red" },
  ask: { word: "NEEDS YOUR CALL", holder: "bg-pp-gold", ink: "text-night", edge: "border-pp-gold" },
};

export interface VerdictStampProps {
  verdict: Verdict;
  /** Override the stamp word (e.g. "VERIFIED", "CHAIN VERIFIED"). Color still follows the decision. */
  label?: string;
  /** One line under the stamp, e.g. "Proposal: $42.18 wooden train set". */
  caption?: string;
  className?: string;
}

/** The guard's call as a clearance strip: the stamped holder on the left, the clauses that decided it on the right. */
export function VerdictStamp({ verdict, label, caption, className = "" }: VerdictStampProps) {
  const look = LOOK[verdict.decision];
  const word = label ?? look.word;
  const hasLines = verdict.violations.length > 0 || verdict.unknowns.length > 0;
  const stampKey = `${verdict.decision}-${verdict.checkedAt}-${word}`;
  let row = 0;
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`@container grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card border-2 bg-card ${caption || hasLines ? "@3xl:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]" : "justify-items-start"} ${look.edge} ${className}`}
    >
      <div key={stampKey} className={`relative isolate flex min-w-0 items-center justify-start px-5 py-4 @3xl:justify-center ${look.ink}`}>
        <span aria-hidden="true" className={`stamp-plate absolute inset-0 -z-10 ${look.holder}`} />
        <span className="stamp-word select-none rounded-sm border-[3px] border-current p-1 text-left @3xl:text-center">
          <span className="block min-w-0 rounded-xs border border-current px-[0.5em] py-[0.3em] font-display text-2xl font-black leading-[1.05] tracking-[0.08em] text-balance @3xl:text-3xl">
            {word}
          </span>
        </span>
      </div>
      {caption || hasLines ? (
        <div key={`c-${stampKey}`} className="min-w-0 px-5 py-5">
          {caption ? (
            <p className="stamp-clause text-base font-semibold text-ink" style={{ "--i": row++ } as CSSProperties}>
              {caption}
            </p>
          ) : null}
          {verdict.violations.length > 0 ? (
            <ul className={`${caption ? "mt-3" : ""} space-y-2 text-sm`} aria-label="Clauses broken">
              {verdict.violations.map((v, i) => (
                <li key={`v${i}`} className="stamp-clause flex gap-2.5" style={{ "--i": row++ } as CSSProperties}>
                  <span className="mt-px h-6 shrink-0 rounded-xs bg-stamp-red px-2 font-mono text-xs font-semibold leading-6 text-on-plate">{v.clauseId}</span>
                  <span className="min-w-0 text-ink">{v.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {verdict.unknowns.length > 0 ? (
            <ul className={`${caption || verdict.violations.length ? "mt-2" : ""} space-y-2 text-sm`} aria-label="Facts the guard could not confirm">
              {verdict.unknowns.map((u, i) => (
                <li key={`u${i}`} className="stamp-clause flex gap-2.5" style={{ "--i": row++ } as CSSProperties}>
                  <span className="mt-px h-6 shrink-0 rounded-xs bg-pp-gold px-2 font-mono text-xs font-semibold leading-6 text-night">{u.clauseId}</span>
                  <span className="min-w-0 text-ink">{u.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default VerdictStamp;
