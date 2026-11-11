import { useId } from "react";
import type { EvidencePack } from "@/core/contracts";
import { ActorIcon } from "./actor-icon";
import { describeEvent } from "./event-text";
import { MoneyTag } from "./money-tag";
import { shortTime, slipFigures, statusWords } from "./slip-figures";

const DECISION_LOOK = {
  within: "bg-pp-sky text-night",
  outside: "bg-stamp-red text-on-plate",
  ask: "bg-pp-gold text-night",
} as const;

const DECISION_WORDS = { within: "WITHIN", outside: "OUTSIDE", ask: "ASK" } as const;

export interface EvidencePackViewProps {
  pack: EvidencePack;
  className?: string;
}

/** A dispute-ready evidence pack: summary, chain check, guard decisions, evidence and the full ledger. */
export function EvidencePackView({ pack, className = "" }: EvidencePackViewProps) {
  const { slip } = pack;
  const f = slipFigures(slip);
  const helperId = useId();
  return (
    <article className={`space-y-6 rounded-card border border-line bg-card p-5 sm:p-6 ${className}`} aria-label={`Evidence pack for ${slip.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">
            <q>{slip.intent}</q>
          </h2>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint">
            <span className="font-semibold text-ink-soft">Evidence pack</span>
            <span className="font-mono">{slip.id}</span>
            <span>{statusWords(slip.status)}</span>
            <span>
              generated <time dateTime={pack.generatedAt}>{shortTime(pack.generatedAt)}</time>
            </span>
          </p>
        </div>
        {pack.chain.ok ? (
          <span className="inline-flex gap-x-3 rounded-pill border border-stamp-green bg-green-wash px-3 py-1 text-sm font-semibold text-stamp-green">
            <span>Chain verified</span>
            <span>{pack.events.length} events</span>
          </span>
        ) : (
          <span className="rounded-pill border border-stamp-red bg-red-wash px-3 py-1 text-sm font-semibold text-stamp-red">
            Chain broken at #{pack.chain.brokenAtSeq}
          </span>
        )}
      </header>

      <p className="text-base text-ink">{pack.summary}</p>

      <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-soft">Budget</dt>
          <dd>
            <MoneyTag money={f.budget} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Spent</dt>
          <dd>
            <MoneyTag money={f.spent} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Released</dt>
          <dd>
            <MoneyTag money={f.released} tone="green" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Refunded</dt>
          <dd>
            <MoneyTag money={f.refunded} tone="muted" />
          </dd>
        </div>
      </dl>

      <section aria-label="Clauses">
        <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">Clauses</h3>
        <ol className="mt-2 divide-y divide-line text-sm text-ink">
          {slip.clauses.map((c) => (
            <li key={c.id} className="flex items-baseline gap-3 py-2">
              <span className="w-[3.25rem] shrink-0 rounded-xs bg-paper-deep py-0.5 text-center font-mono text-xs font-semibold text-ink-soft">{c.id}</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Guard decisions">
        <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">Guard decisions ({pack.verdicts.length})</h3>
        {pack.verdicts.length === 0 ? (
          <p className="text-sm text-ink-faint">None recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {pack.verdicts.map((v, i) => (
              <li key={`${v.checkedAt}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className={`rounded-xs px-2 py-0.5 text-xs font-semibold ${DECISION_LOOK[v.decision]}`}>{DECISION_WORDS[v.decision]}</span>
                <time className="font-mono text-xs text-ink-faint" dateTime={v.checkedAt}>
                  {shortTime(v.checkedAt)}
                </time>
                {[...v.violations, ...v.unknowns].map((x, j) => (
                  <span key={j} className="flex gap-x-3 text-ink-soft">
                    <span className="font-mono">{x.clauseId}</span>
                    <span>{x.message}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Evidence">
        <h3 className="font-display text-lg font-extrabold tracking-tight text-ink">Evidence ({pack.evidence.length})</h3>
        {pack.evidence.length === 0 ? (
          <p className="text-sm text-ink-faint">None attached.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {pack.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-ink">
                <span className="font-semibold">{e.kind.replace(/_/g, " ")}</span>
                <span className={`font-semibold ${e.verdict === "pass" ? "text-stamp-green" : e.verdict === "fail" ? "text-stamp-red" : "text-stamp-amber"}`}>{e.verdict}</span>
                <span>{e.detail}</span>
                {e.ref ? (
                  e.ref.startsWith("blob_") ? (
                    <a
                      className="font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep"
                      href={`/api/blobs/${encodeURIComponent(e.ref)}`}
                    >
                      view file
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-ink-faint">{e.ref}</span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pack.children.length > 0 ? (
        <section aria-labelledby={helperId}>
          <h3 id={helperId} className="font-display text-lg font-extrabold tracking-tight text-ink">
            <span className="sr-only">Helper slips in the evidence pack </span>
            <span aria-hidden="true">Helper slips </span>({pack.children.length})
          </h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {pack.children.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-ink">
                <q>{c.intent}</q>
                <span>
                  <MoneyTag money={c.spent} /> of <MoneyTag money={c.budget} />
                </span>
                <span className="font-mono text-xs text-ink-faint">{c.id}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="rounded-md bg-paper-deep p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink transition-colors duration-[120ms] hover:text-pp-blue active:text-pp-deep">Every event in the evidence pack ({pack.events.length})</summary>
        <ol className="mt-3 space-y-3">
          {pack.events.map((e) => {
            const { title, detail } = describeEvent(e);
            return (
              <li key={e.seq} id={`pack-ledger-${e.seq}`} className="flex gap-3 text-sm">
                <ActorIcon actor={e.actor} />
                <div className="min-w-0">
                  <p className="text-ink">
                    {title}
                    {detail ? <span className="ml-3 text-ink-soft">{detail}</span> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 break-all text-xs text-ink-faint">
                    <span className="font-mono text-ink-soft">#{e.seq}</span>
                    <span className="font-mono">{e.type}</span>
                    <span>{shortTime(e.at)}</span>
                    <span>
                      prev <span className="font-mono">{e.prevHash.slice(0, 12)}</span>
                    </span>
                    <span>
                      hash <span className="font-mono">{e.hash.slice(0, 12)}</span>
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </details>

      <p>
        <a
          className="inline-flex h-11 items-center whitespace-nowrap rounded-pill border border-edge px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep"
          href={`/api/slips/${encodeURIComponent(slip.id)}/evidence?download=1`}
        >
          Download evidence JSON
        </a>
      </p>
    </article>
  );
}

export default EvidencePackView;
