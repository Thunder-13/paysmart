import { useId } from "react";
import type { Clause, Slip } from "@/core/contracts";
import { MoneyTag } from "./money-tag";
import { evidenceState, isSigned, shortTime, slipFigures, statusWords, type EvidenceState } from "./slip-figures";

const STATUS_TONE: Record<Slip["status"], string> = {
  draft: "border-line text-ink-soft",
  awaiting_signature: "border-pp-gold bg-pp-gold-wash text-stamp-amber",
  active: "border-pp-blue bg-pp-sky-wash text-pp-deep",
  settling: "border-pp-gold bg-pp-gold-wash text-stamp-amber",
  settled: "border-ink bg-ink text-on-night",
  released: "border-edge text-ink-soft",
  refunded: "border-edge text-ink-soft",
  disputed: "border-stamp-red bg-red-wash text-stamp-red",
  expired: "border-line text-ink-faint",
  rejected: "border-stamp-red bg-red-wash text-stamp-red",
};

const EVIDENCE_LOOK: Record<EvidenceState, { text: string; className: string; icon: string }> = {
  met: { text: "met", className: "text-stamp-green", icon: "M4 10l4 4 8-9" },
  pending: { text: "pending", className: "text-stamp-amber", icon: "M10 5v5l3 2" },
  failed: { text: "failed", className: "text-stamp-red", icon: "M5 5l10 10M15 5L5 15" },
};

function EvidenceBadge({ state }: { state: EvidenceState }) {
  const look = EVIDENCE_LOOK[state];
  return (
    <span className={`ml-2 inline-flex items-center gap-1 text-xs font-semibold ${look.className}`}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d={look.icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {look.text}
    </span>
  );
}

/** The gold seal a signed slip carries. */
function Seal() {
  return (
    <span aria-hidden="true" className="stamp-seal -my-1 inline-flex shrink-0">
    <svg viewBox="0 0 20 20" className="h-9 w-9">
      <path d="M10 1.5l2 1.6 2.5-.3 1 2.3 2.3 1-.3 2.5 1.6 2-1.6 2 .3 2.5-2.3 1-1 2.3-2.5-.3-2 1.6-2-1.6-2.5.3-1-2.3-2.3-1 .3-2.5L1.5 10l1.6-2-.3-2.5 2.3-1 1-2.3 2.5.3z" className="fill-pp-gold" />
      <path d="M6.5 10.2l2.3 2.3 4.7-5" fill="none" className="stroke-night" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    </span>
  );
}

function ClauseLine({ clause, slip }: { clause: Clause; slip: Slip }) {
  return (
    <li className="flex items-baseline gap-3 py-2.5">
      <span className="w-[3.25rem] shrink-0 rounded-xs bg-ink py-0.5 text-center font-mono text-xs font-semibold text-on-night">{clause.id}</span>
      <span className="min-w-0 text-base leading-6 text-ink [overflow-wrap:anywhere]">
        {clause.label}
        {clause.kind === "require_evidence" ? <EvidenceBadge state={evidenceState(slip, clause.evidence)} /> : null}
      </span>
    </li>
  );
}

/** In-app signature (slip.meta.signedInApp) for slips that never get a PayPal order, e.g. payouts from a balance. */
function signedInApp(slip: Slip): { by: string | null; at: string | null } | null {
  if (slip.rail.orderId) return null;
  const raw = slip.meta.signedInApp;
  if (!raw) return null;
  const o = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { by: typeof o.by === "string" && o.by ? o.by : null, at: typeof o.at === "string" && o.at ? o.at : null };
}

export interface SlipCardProps {
  slip: Slip;
  /** Helper slips carved from this one, drawn as small nested slips. */
  childSlips?: Slip[];
  /** Heading override; defaults to "Permission Slip". */
  title?: string;
  className?: string;
}

/** The slip: summary, numbered clauses, money, status and the PayPal signature line, torn from a pad. */
export function SlipCard({ slip, childSlips = [], title = "Permission Slip", className = "" }: SlipCardProps) {
  const helperId = useId();
  const f = slipFigures(slip);
  const summary = typeof slip.meta.summary === "string" && slip.meta.summary ? slip.meta.summary : null;
  const signed = isSigned(slip);
  const inApp = signed ? null : signedInApp(slip);
  return (
    <article aria-label={`${title} ${slip.id}`} className={`@container relative overflow-hidden rounded-card border border-line bg-card ${className}`}>
      <div className="relative h-4 w-full border-b-2 border-dashed border-edge bg-paper-deep" aria-hidden="true">
        <span className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-line bg-paper" />
        <span className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-line bg-paper" />
      </div>
      <div className="px-6 pb-6 pt-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="font-mono text-xs text-ink-faint">{slip.id}</p>
          </div>
          <span className={`whitespace-nowrap rounded-pill border px-3 py-0.5 text-xs font-semibold ${STATUS_TONE[slip.status]}`}>{statusWords(slip.status)}</span>
        </header>

        {summary ? <p className="mt-4 font-display text-xl font-extrabold leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">{summary}</p> : null}
        <p className={`[overflow-wrap:anywhere] ${summary ? "mt-2 text-sm text-ink-soft" : "mt-4 font-display text-xl font-extrabold leading-snug tracking-tight text-ink"}`}>
          {summary ? "In your words: " : null}
          <q>{slip.intent}</q>
        </p>
        <p className="mt-1 text-xs text-ink-faint">{slip.principal.name}</p>

        <ol className="mt-5 divide-y divide-dashed divide-line border-y border-dashed border-line" aria-label="Clauses">
          {slip.clauses.map((c) => (
            <ClauseLine key={c.id} clause={c} slip={slip} />
          ))}
        </ol>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-4">
          {(
            [
              ["Budget", f.budget, "neutral"],
              ["Held", f.held, "amber"],
              ["Spent", f.spent, "neutral"],
              ["Released", f.released, "green"],
              ["Refunded", f.refunded, "muted"],
            ] as const
          ).map(([label, money, tone]) => (
            <div key={label} className={`min-w-0 pt-2 ${label === "Budget" ? "col-span-full border-t-2 border-ink pb-1" : "border-t border-line"}`}>
              <dt className="text-xs text-ink-soft">{label}</dt>
              <dd className={label === "Budget" ? "font-display text-4xl font-extrabold leading-none" : "text-lg"}>
                <MoneyTag money={money} tone={tone} />
              </dd>
            </div>
          ))}
        </dl>

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[14rem] flex-1">
            <div className="flex items-center gap-2 border-b border-ink pb-1.5 text-base font-semibold text-ink">
              {signed ? (
                <>
                  <Seal />
                  <span>Signed with PayPal</span>
                  <span className="ml-auto min-w-0 break-all font-mono text-xs font-normal text-ink-soft">{slip.rail.orderId}</span>
                </>
              ) : inApp ? (
                <>
                  <Seal />
                  <span>Signed in the app{inApp.by ? ` by ${inApp.by}` : ""}</span>
                  {inApp.at ? (
                    <time dateTime={inApp.at} className="ml-auto font-mono text-sm font-normal text-ink-soft">
                      {shortTime(inApp.at)}
                    </time>
                  ) : null}
                </>
              ) : slip.status === "awaiting_signature" ? (
                <span className="text-stamp-amber">Waiting for your signature</span>
              ) : (
                <span className="font-normal text-ink-faint">Not signed</span>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-faint">Signature</p>
          </div>
          <p className="text-xs text-ink-soft">
            Good until <time dateTime={slip.expiresAt}>{shortTime(slip.expiresAt)}</time>
          </p>
        </footer>

        {childSlips.length > 0 ? (
          <section className="mt-6" aria-labelledby={helperId}>
            <h2 id={helperId} className="sr-only">Helper slips on this slip</h2>
            <p aria-hidden="true" className="text-sm font-semibold text-ink">Helper slips</p>
            <ul className="mt-2 space-y-2">
              {childSlips.map((c) => {
                const cf = slipFigures(c);
                return (
                  <li key={c.id} className="rounded-md border border-dashed border-edge bg-paper px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <q className="text-sm text-ink">{c.intent}</q>
                      <span className={`whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status]}`}>{statusWords(c.status)}</span>
                    </div>
                    <p className="mt-2 flex flex-wrap gap-5 text-sm text-ink-soft">
                      <MoneyTag money={cf.budget} label="Budget" />
                      <MoneyTag money={cf.spent} label="Spent" />
                      <span className="self-end font-mono text-xs text-ink-faint">{c.id}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}

export default SlipCard;
