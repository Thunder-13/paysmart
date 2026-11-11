"use client";
import { useEffect, useRef, useState } from "react";
import type { LedgerEvent } from "@/core/contracts";
import { ActorIcon } from "./actor-icon";
import { describeEvent } from "./event-text";
import { fetchJson, useSlipEvents } from "./run-client";
import { shortTime } from "./slip-figures";

export interface LedgerTimelineProps {
  slipId: string;
  /** Scroll to and focus the row for this seq (rows have id="ledger-<seq>"). */
  focusSeq?: number;
  /** Heading override; defaults to "Ledger". */
  title?: string;
  className?: string;
}

type Chain = { ok: boolean; brokenAtSeq: number | null };

/** Live, hash-chained event list for one slip with a "Chain verified" badge. */
export function LedgerTimeline({ slipId, focusSeq, title = "Ledger", className = "" }: LedgerTimelineProps) {
  const { events, connected } = useSlipEvents(slipId);
  const [chain, setChain] = useState<{ slipId: string; count: number; value: Chain } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const count = events.length;

  // Re-verify the chain on the server whenever new events arrive.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchJson<{ chain: Chain }>(`/api/slips/${encodeURIComponent(slipId)}`)
        .then((res) => {
          if (!cancelled) setChain({ slipId, count, value: res.chain });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slipId, count]);

  useEffect(() => {
    if (focusSeq === undefined) return;
    const row = listRef.current?.querySelector<HTMLElement>(`#ledger-${focusSeq}`);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.focus({ preventScroll: true });
    }
  }, [focusSeq, count]);

  const verified = chain && chain.slipId === slipId ? chain.value : null;

  return (
    <section className={`rounded-card border border-line bg-card ${className}`} aria-label={`${title} for ${slipId}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">{title}</h2>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className={`rounded-pill border px-2.5 py-0.5 ${connected ? "border-stamp-green text-stamp-green" : "border-line text-ink-faint"}`}>
            {connected ? "Live" : "Connecting"}
          </span>
          {verified ? (
            verified.ok ? (
              <span className="rounded-pill bg-stamp-green px-2.5 py-0.5 text-on-plate">Chain verified</span>
            ) : (
              <span className="rounded-pill bg-stamp-red px-2.5 py-0.5 text-on-plate">Chain broken at #{verified.brokenAtSeq}</span>
            )
          ) : null}
        </div>
      </header>
      {events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-faint">No events yet.</p>
      ) : (
        <ol ref={listRef} className="relative py-2" aria-live="polite" aria-relevant="additions">
          <li aria-hidden="true" className="pointer-events-none absolute bottom-6 left-9 top-6 w-px bg-edge" />
          {events.map((e: LedgerEvent, idx) => {
            const { title: line, detail } = describeEvent(e);
            const broken = verified && !verified.ok && verified.brokenAtSeq !== null && e.seq >= verified.brokenAtSeq;
            return (
              <li
                key={e.seq}
                id={`ledger-${e.seq}`}
                tabIndex={-1}
                title={`Hash ${e.hash}`}
                className={`relative grid animate-fade-in grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-5 py-3.5 transition-colors duration-[120ms] hover:bg-paper focus:bg-pp-gold-wash ${broken ? "bg-red-wash" : ""} ${
                  focusSeq === e.seq ? "ring-2 ring-inset ring-pp-gold" : ""
                }`}
              >
                {idx > 0 ? (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="absolute left-9 top-0 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 bg-(--color-card) p-px text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.6.6M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.6-.6" />
                  </svg>
                ) : null}
                <span className="relative z-10 self-start">
                  <ActorIcon actor={e.actor} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{line}</p>
                  {detail ? <p className="break-words text-sm text-ink-soft">{detail}</p> : null}
                  <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-ink-faint">
                    <span className="text-ink-soft">#{e.seq}</span>
                    <span>{e.type}</span>
                    <time dateTime={e.at}>{shortTime(e.at)}</time>
                    <span title={e.hash} className="cursor-help">
                      {e.hash.slice(0, 10)}
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default LedgerTimeline;
