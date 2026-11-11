import type { CSSProperties, ReactNode } from "react";
import type { Slip, SlipStatus } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import type { BoardStrip } from "./board-strips";

/** The three bays, in the order a judge reads a verdict scale. Red belongs to refusal alone. */
export const BAYS: { decision: BoardStrip["decision"]; name: string; holder: string; glyph: string }[] = [
  { decision: "within", name: "Within slip", holder: "bg-pp-sky text-night", glyph: "M5 10.5l3.2 3.2L15 7" },
  { decision: "ask", name: "Needs your call", holder: "bg-pp-gold text-night", glyph: "M8 7.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.6M10 14h.01" },
  { decision: "outside", name: "Outside slip", holder: "bg-stamp-red text-on-plate", glyph: "M6.5 6.5l7 7M13.5 6.5l-7 7" },
];

/** Statuses a buyer has actually signed through. Draft and awaiting_signature have not been. */
const SIGNED: ReadonlySet<SlipStatus> = new Set<SlipStatus>(["active", "settling", "settled", "released", "refunded", "disputed"]);

/** Stamp words for the hero replay. Only a settled call gets one; "ask" strips keep their gold holder. */
const STAMPS: Partial<Record<BoardStrip["decision"], { word: string; cls: string }>> = {
  outside: { word: "OUTSIDE SLIP", cls: "bg-stamp-red text-on-plate" },
  within: { word: "WITHIN SLIP", cls: "bg-pp-sky text-night" },
};

function Strip({ strip, order, hero }: { strip: BoardStrip; order: number; hero: boolean }) {
  const bay = BAYS.find((b) => b.decision === strip.decision) ?? BAYS[0];
  const stamp = hero ? STAMPS[strip.decision] : undefined;
  const pass = strip.decision === "within";
  return (
    <li
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)] overflow-hidden rounded-md bg-card text-ink replay-strip ${hero ? "replay-strip--hero" : "replay-strip--band"}`}
      style={{ "--i": order } as CSSProperties}
    >
      <span className={`flex items-center justify-center ${bay.holder}`}>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-5 w-5 ${pass ? "replay-check" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={bay.glyph} />
        </svg>
      </span>
      <span aria-hidden="true" className={`replay-scan ${pass ? "replay-scan--rtl" : ""}`} />
      {stamp ? (
        <span aria-hidden="true" className="replay-stamp">
          <span className={`rounded-sm px-4 py-1.5 font-display text-2xl font-black uppercase leading-none tracking-widest ${stamp.cls}`}>{stamp.word}</span>
        </span>
      ) : null}
      <div className="min-w-0 px-3.5 py-2.5">
        <p className="flex items-start justify-between gap-3">
          <span className="line-clamp-3 min-w-0 text-sm font-semibold leading-snug">
            {strip.title}
            {strip.more > 0 ? <span className="font-normal text-ink-soft"> and {strip.more} more</span> : null}
          </span>
          <data value={`${strip.amount.value} ${strip.amount.currency}`} className="shrink-0 font-display text-xl font-extrabold leading-none tabular-nums tracking-tight">
            {formatMoney(strip.amount)}
          </data>
        </p>
        {strip.broken.length + strip.unknown.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={strip.decision === "outside" ? "Clauses broken" : "Facts the guard could not confirm"}>
            {strip.broken.map((c, j) => (
              <li
                key={c}
                className={`rounded-xs bg-stamp-red px-1.5 font-mono text-xs font-semibold leading-5 text-on-plate ${hero ? "replay-chip" : ""}`}
                style={{ "--j": j } as CSSProperties}
              >
                {c}
              </li>
            ))}
            {strip.unknown.map((c) => (
              <li key={c} className="rounded-xs bg-pp-gold px-1.5 font-mono text-xs font-semibold leading-5 text-night">
                {c}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-faint">
          <span className="font-mono text-ink-soft">#{strip.seq}</span>
          <span className="font-mono" title={strip.hash}>
            {strip.hash.slice(0, 8)}
          </span>
          {strip.origin.host ? <span className="min-w-0 truncate font-mono">{strip.origin.host}</span> : null}
          {strip.origin.injection ? <span className="font-semibold text-stamp-red">listing text tried to instruct the agent</span> : null}
        </p>
      </div>
    </li>
  );
}

function Bay({ name, strips, order, hero }: { name: string; strips: BoardStrip[]; order: Map<number, number>; hero: boolean }) {
  return (
    <>
      <p className="flex items-baseline justify-between text-sm font-semibold text-on-night">
        {name}
        <span className="font-mono text-xs font-normal text-on-night-soft">{strips.length}</span>
      </p>
      {strips.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {strips.map((s) => (
            <Strip key={s.seq} strip={s} order={order.get(s.seq) ?? 0} hero={hero} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-night-line px-3.5 py-2.5 text-sm text-on-night-soft">None on this slip</p>
      )}
    </>
  );
}

export interface ClearanceBoardProps {
  strips: BoardStrip[];
  /** Pinned over the board's edge in the hero variant. */
  slip?: Slip | null;
  /** "hero": slip pinned beside stacked bays. "band": three bays side by side, for a run screen. */
  variant?: "hero" | "band";
  caption?: ReactNode;
}

/** The guard's calls racked into bays: Within slip, Needs your call, Outside slip. */
export function ClearanceBoard({ strips, slip = null, variant = "hero", caption }: ClearanceBoardProps) {
  const order = new Map(strips.map((s, i) => [s.seq, i]));
  /** For each broken clause: the strip that first broke it, and its place in that strip's list (so it lights when the scan reaches it). */
  const litBy = new Map<string, { i: number; j: number }>();
  for (const s of strips) s.broken.forEach((c, j) => { if (!litBy.has(c)) litBy.set(c, { i: order.get(s.seq) ?? 0, j }); });

  if (variant === "band") {
    return (
      <figure aria-label="Clearance board" className="@container on-night rounded-2xl bg-night p-5 text-on-night sm:p-6">
        {/* Bays sit side by side only when the board itself is wide: it also lives in narrow columns (Dispute Desk, bounty cards). */}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 @4xl:grid-cols-3" aria-label="Bays">
          {BAYS.map((b) => (
            <li key={b.decision} className="min-w-0">
              <Bay name={b.name} strips={strips.filter((s) => s.decision === b.decision)} order={order} hero={false} />
            </li>
          ))}
        </ul>
        {caption ? <figcaption className="mt-4 text-sm text-on-night-soft">{caption}</figcaption> : null}
      </figure>
    );
  }

  return (
    <figure aria-label={slip ? `Clearance board for ${slip.id}` : "Clearance board"} className="relative">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {slip ? (
          <div className="relative z-[10] order-2 md:order-none md:-mr-2 md:mt-2">
            <div aria-hidden="true" className="absolute inset-0 hidden translate-x-3 translate-y-3 rotate-[3deg] rounded-xl bg-paper-deep md:block" />
            <article aria-label={`Permission Slip ${slip.id}`} className="replay-slip relative overflow-hidden rounded-xl bg-card text-ink md:-rotate-[1.5deg]">
              <div className="slip-perforation h-2 w-full bg-night-2" aria-hidden="true" />
              <div className="px-5 pb-5 pt-3">
                <p className="text-sm font-semibold">Permission Slip</p>
                <p className="truncate font-mono text-xs text-ink-faint">{slip.id}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-snug text-ink-soft">
                  <q>{slip.intent}</q>
                </p>
                <ol className="mt-3 divide-y divide-dashed divide-line border-y border-dashed border-line" aria-label="Clauses">
                  {slip.clauses.map((c, k) => {
                    const lit = litBy.get(c.id);
                    return (
                      <li key={c.id} className="replay-row flex items-baseline gap-2.5 py-1.5" style={{ "--k": k } as CSSProperties}>
                        <span
                          className={`w-9 shrink-0 rounded-xs py-px text-center font-mono text-xs font-semibold ${lit ? "clause-lit" : "bg-paper-deep text-ink-soft"}`}
                          style={lit ? ({ "--i": lit.i, "--j": lit.j } as CSSProperties) : undefined}
                        >
                          {c.id}
                        </span>
                        <span className="min-w-0 text-sm leading-5">{c.label}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 flex items-end justify-between gap-3">
                  <span className="text-xs text-ink-soft">Budget, held by PayPal when signed</span>
                  <data value={`${slip.budget.value} ${slip.budget.currency}`} className="font-display text-3xl font-extrabold tabular-nums tracking-tight">
                    {formatMoney(slip.budget)}
                  </data>
                </p>
                <div className="relative mt-5 h-9 border-b border-ink-faint">
                  <span className="absolute bottom-1 left-0 text-xs text-ink-faint">Signature</span>
                  {SIGNED.has(slip.status) ? (
                    <span className="replay-seal absolute bottom-1 right-2 rounded-sm border-2 border-pp-blue px-2 py-0.5 font-display text-base font-extrabold leading-tight text-pp-blue">
                      Signed
                    </span>
                  ) : null}
                </div>
              </div>
            </article>
          </div>
        ) : null}

        <div className="relative order-1 md:order-none md:-ml-10 md:mt-10">
          <div aria-hidden="true" className="absolute inset-0 hidden -translate-x-2 translate-y-3 rotate-[1.5deg] rounded-2xl bg-pp-deep md:block" />
          <ul className="relative space-y-4 rounded-2xl bg-night-2 p-4 md:pl-14" aria-label="Bays">
            {BAYS.map((b) => (
              <li key={b.decision} className="rack pb-4 last:bg-none last:pb-0">
                <Bay name={b.name} strips={strips.filter((s) => s.decision === b.decision)} order={order} hero />
              </li>
            ))}
          </ul>
        </div>
      </div>
      {caption ? <figcaption className="replay-caption mt-6 text-sm text-on-night-soft">{caption}</figcaption> : null}
    </figure>
  );
}

export default ClearanceBoard;
