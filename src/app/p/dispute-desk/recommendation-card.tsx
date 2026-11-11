"use client";
import type { Clause } from "@/core/contracts";
import { MoneyTag } from "@/components/money-tag";
import type { Recommendation } from "@/pipelines/dispute-desk/types";
import { decisionWords } from "@/pipelines/dispute-desk/view";

/** The strip's holder per tone, the same vocabulary as VerdictStamp: sky cleared, gold your call, red refusal. */
const HOLDER: Record<"red" | "amber" | "green" | "muted", { holder: string; edge: string }> = {
  green: { holder: "bg-pp-sky text-night", edge: "border-pp-sky" },
  amber: { holder: "bg-pp-gold text-night", edge: "border-pp-gold" },
  red: { holder: "bg-stamp-red text-on-plate", edge: "border-stamp-red" },
  muted: { holder: "bg-paper-deep text-ink", edge: "border-line" },
};

export function RecommendationCard({ rec, clauses, onCite }: { rec: Recommendation; clauses: Clause[]; onCite: (seq: number) => void }) {
  const d = decisionWords(rec.decision);
  const look = HOLDER[d.tone];
  return (
    <article aria-labelledby="rec-title" className={`overflow-hidden rounded-card border-2 bg-card ${look.edge}`}>
      <header className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 ${look.holder}`}>
        <span className="inline-block animate-stamp select-none whitespace-nowrap rounded-sm border-[3px] border-current px-3 py-1.5 font-display text-xl font-extrabold leading-none tracking-[0.06em] motion-reduce:animate-none">
          {d.word}
        </span>
        <span className="rounded-pill border border-current px-2.5 py-0.5 text-xs font-semibold tabular-nums">{Math.round(rec.confidence * 100)}% confidence</span>
      </header>

      <div className="px-5 py-5">
        <h2 id="rec-title" className="font-display text-xl font-extrabold tracking-tight text-ink">
          Recommendation: {d.word}
        </h2>
        <p className="mt-2 text-base leading-relaxed text-ink">{rec.rationale}</p>

        {rec.override ? (
          <p className="mt-4 rounded-md bg-pp-gold-wash px-4 py-3 text-sm text-ink">
            <strong className="font-semibold">Changed from {rec.override.from.replace("_", " ")}:</strong> {rec.override.reason}
          </p>
        ) : null}

        {rec.alreadyRefunded ? (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
            <MoneyTag money={rec.alreadyRefunded.amount} label="Already refunded" tone="amber" />
            <button
              type="button"
              onClick={() => onCite(rec.alreadyRefunded!.seq)}
              className="text-sm font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue focus-visible:outline-offset-4 active:text-pp-deep"
            >
              at <span className="font-mono text-xs">#{rec.alreadyRefunded.seq}</span>
            </button>
          </p>
        ) : null}

        {rec.citedSeqs.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink-soft">Cited ledger events</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {rec.citedSeqs.map((seq) => (
                <li key={seq}>
                  <button
                    type="button"
                    onClick={() => onCite(seq)}
                    aria-label={`Show ledger event ${seq}`}
                    className="inline-flex h-9 items-center rounded-pill border border-edge px-3.5 font-mono text-xs font-semibold text-ink transition-colors duration-[120ms] hover:border-ink focus-visible:outline-offset-2 active:bg-paper-deep"
                  >
                    #{seq}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {rec.citedClauseIds.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink-soft">Cited clauses</p>
            <ul className="mt-2 space-y-2">
              {rec.citedClauseIds.map((id) => (
                <li key={id} className="flex gap-2.5 text-sm text-ink">
                  <span className="mt-px h-6 shrink-0 rounded-xs bg-paper-deep px-2 font-mono text-xs font-semibold leading-6 text-ink-soft">{id}</span>
                  <span className="min-w-0">{clauses.find((c) => c.id === id)?.label ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {rec.missing.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink-soft">To contest you&apos;d need</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              {rec.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {rec.warnings.length > 0 ? (
          <ul className="mt-5 space-y-2" aria-label="Warnings">
            {rec.warnings.map((w) => (
              <li key={w} className="rounded-md bg-pp-gold-wash px-4 py-2.5 text-sm text-ink">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
