"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LedgerEvent } from "@/core/contracts";
import { canonicalJson } from "@/core/store/canonical-json";
import { verifyChainWeb, webCryptoAvailable, type WebChainResult, type WebLedgerEvent } from "@/core/store/browser-hash";
import { describeEvent } from "./event-text";

type Edit = { data?: unknown; at?: string };
type Edits = Record<number, Edit>;
type TileState = "pending" | "ok" | "bad" | "cascade";

const REVEAL_MS = 25;
const noopSubscribe = () => () => {};
const BTN_NIGHT =
  "inline-flex h-11 items-center rounded-pill border border-night-line px-5 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:border-on-night active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55";
const BTN_INVERT =
  "inline-flex h-11 items-center rounded-pill bg-on-night px-6 text-sm font-semibold text-night transition-colors duration-[120ms] hover:bg-pp-sky active:bg-pp-sky disabled:cursor-not-allowed disabled:opacity-55";

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function tileLabel(type: string): string {
  return type.replace(/[._]/g, " ");
}

function prettyCanonical(data: unknown): string {
  return JSON.stringify(JSON.parse(canonicalJson(data)), null, 2);
}

function applyEdits(base: readonly WebLedgerEvent[], edits: Edits): WebLedgerEvent[] {
  return base.map((e) => {
    const ed = edits[e.seq];
    if (!ed) return e;
    return { ...e, ...(ed.at !== undefined ? { at: ed.at } : {}), ...("data" in ed ? { data: ed.data } : {}) };
  });
}

function ms(n: number): string {
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function HashLine({ label, hash, against, tone }: { label: string; hash: string; against: string; tone: "stored" | "recomputed" }) {
  const at = tone === "recomputed" ? firstDiff(hash, against) : -1;
  return (
    <div>
      <dt className="text-xs text-on-night-soft">{label}</dt>
      <dd className="break-all font-mono text-xs leading-relaxed text-on-night">
        {at < 0 ? (
          hash
        ) : (
          <>
            {hash.slice(0, at)}
            <span className="bg-stamp-red px-px font-extrabold text-on-plate">{hash.charAt(at)}</span>
            {hash.slice(at + 1)}
          </>
        )}
      </dd>
    </div>
  );
}

export function ChainLab({
  slipId,
  events,
  server,
}: {
  slipId: string;
  events: LedgerEvent[];
  server: { ok: boolean; brokenAtSeq: number | null };
}) {
  const base = events as WebLedgerEvent[];
  const total = base.length;
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const runId = useRef(0);
  const hasCrypto = useSyncExternalStore(noopSubscribe, webCryptoAvailable, () => true);
  const crypto = hasCrypto ? "yes" : "no";
  const [edits, setEdits] = useState<Edits>({});
  const [result, setResult] = useState<WebChainResult | null>(null);
  const [shown, setShown] = useState(0);
  const [took, setTook] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [rover, setRover] = useState(0);
  const grid = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const effective = useMemo(() => applyEdits(base, edits), [base, edits]);
  const tampered = Object.keys(edits).length > 0;

  const verify = useCallback(
    async (list: WebLedgerEvent[], reveal: boolean) => {
      const id = ++runId.current;
      const t0 = performance.now();
      const res = await verifyChainWeb(list);
      const dt = performance.now() - t0;
      if (id !== runId.current) return;
      setResult(res);
      setTook(dt);
      if (!reveal) {
        setShown(list.length);
        return;
      }
      let n = 0;
      const timer = window.setInterval(() => {
        if (id !== runId.current) {
          window.clearInterval(timer);
          return;
        }
        n += 1;
        setShown(n);
        if (n >= list.length) window.clearInterval(timer);
      }, REVEAL_MS);
    },
    [],
  );

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (!hasCrypto) return;
    const go = () => {
      if (started.current) return;
      started.current = true;
      void verify(base, true);
    };
    if (typeof IntersectionObserver === "undefined") {
      go();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          go();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [base, hasCrypto, verify]);

  const draftFor = useCallback(
    (seq: number, list: WebLedgerEvent[]) => {
      const e = list.find((x) => x.seq === seq);
      return e ? prettyCanonical(e.data) : "";
    },
    [],
  );

  const commit = useCallback(
    (next: Edits, focusSeq: number | null) => {
      started.current = true;
      setEdits(next);
      const list = applyEdits(base, next);
      if (focusSeq !== null) {
        setSelected(focusSeq);
        setDraft(draftFor(focusSeq, list));
        setDraftError(null);
      } else if (selected !== null) {
        setDraft(draftFor(selected, list));
        setDraftError(null);
      }
      void verify(list, false);
    },
    [base, draftFor, selected, verify],
  );

  const presets = useMemo(() => {
    const out: { key: string; label: string; seq: number; edit: Edit }[] = [];
    const cap = base.find((e) => e.type === "rail.captured" && typeof obj(obj(e.data).amount).value === "string");
    if (cap) {
      const amount = obj(obj(cap.data).amount);
      const n = Number(amount.value);
      if (Number.isFinite(n)) {
        out.push({
          key: "capture",
          label: "Shrink the capture",
          seq: cap.seq,
          edit: { data: { ...obj(cap.data), amount: { ...amount, value: (n * 0.1).toFixed(2) } } },
        });
      }
    }
    const verdict = base.find((e) => e.type === "guard.verdict" && obj(obj(e.data).verdict).decision === "outside");
    if (verdict) {
      out.push({
        key: "verdict",
        label: "Flip the verdict to within",
        seq: verdict.seq,
        edit: { data: { ...obj(verdict.data), verdict: { ...obj(obj(verdict.data).verdict), decision: "within" } } },
      });
    }
    const signed = base.find((e) => e.type === "slip.signed") ?? base[0];
    if (signed && Number.isFinite(Date.parse(signed.at))) {
      out.push({
        key: "backdate",
        label: "Backdate one event",
        seq: signed.seq,
        edit: { at: new Date(Date.parse(signed.at) - 60_000).toISOString() },
      });
    }
    return out;
  }, [base]);

  /* One tab stop for the whole tile grid: the tile last focused, else the selected one, else the first. */
  const tabStop = Math.min(Math.max(rover, 0), Math.max(total - 1, 0));
  const onTileKey = (ev: React.KeyboardEvent<HTMLOListElement>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const tiles = grid.current ? Array.from(grid.current.querySelectorAll<HTMLButtonElement>("button.chain-tile")) : [];
    const at = tiles.findIndex((t) => t === document.activeElement);
    if (at < 0 || tiles.length === 0) return;
    const cols = Math.max(1, grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").filter(Boolean).length : 1);
    const last = tiles.length - 1;
    let to = at;
    if (ev.key === "ArrowRight") to = Math.min(last, at + 1);
    else if (ev.key === "ArrowLeft") to = Math.max(0, at - 1);
    else if (ev.key === "ArrowDown") to = at + cols <= last ? at + cols : at;
    else if (ev.key === "ArrowUp") to = at - cols >= 0 ? at - cols : at;
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = last;
    else return;
    ev.preventDefault();
    setRover(to);
    tiles[to].focus();
  };

  const select = (seq: number) => {
    setSelected(seq);
    setDraft(draftFor(seq, effective));
    setDraftError(null);
  };

  const applyDraft = () => {
    if (selected === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setDraftError(`That is not valid JSON. ${err instanceof Error ? err.message : ""}`.trim());
      return;
    }
    const orig = base.find((e) => e.seq === selected);
    const next: Edits = { ...edits };
    const prior = next[selected] ?? {};
    if (orig && canonicalJson(parsed) === canonicalJson(orig.data)) {
      const { data: _drop, ...rest } = prior;
      void _drop;
      if (Object.keys(rest).length) next[selected] = rest;
      else delete next[selected];
    } else {
      next[selected] = { ...prior, data: parsed };
    }
    setDraftError(null);
    commit(next, selected);
  };

  const restore = () => {
    commit({}, selected);
  };

  const links = result?.links ?? null;
  const brokenIdx = result?.brokenAtSeq != null ? effective.findIndex((e) => e.seq === result.brokenAtSeq) : -1;
  const passing = links ? links.filter((l) => l.status === "ok").length : 0;
  const after = brokenIdx >= 0 ? total - brokenIdx - 1 : 0;
  const revealed = result !== null && shown >= total;

  const stateOf = (i: number): TileState => {
    if (!links || i >= shown) return "pending";
    const s = links[i].status;
    return s === "ok" ? "ok" : s === "hash-mismatch" ? "bad" : "cascade";
  };

  const sel = selected !== null ? effective.find((e) => e.seq === selected) : undefined;
  const selIdx = sel ? effective.indexOf(sel) : -1;
  const selLink = links && selIdx >= 0 ? links[selIdx] : null;
  const selNote =
    !selLink || selIdx >= shown
      ? "Not checked yet."
      : selLink.status === "ok"
        ? "The two hashes match and the link to the event before it holds."
        : selLink.status === "hash-mismatch"
          ? "This event no longer hashes to the value stored with it."
          : "An earlier link failed, so nothing after it can be trusted.";

  return (
    <div ref={root}>
      <h2 id="recent-heading" className="max-w-[20ch] font-display text-section font-extrabold leading-[1.02] tracking-[-0.03em] text-on-night">
        Change one byte. Watch the chain break.
      </h2>
      <p className="mt-5 max-w-[56ch] text-lg text-on-night-soft">
        Your browser recomputes every SHA-256 link of this slip with Web Crypto. Nothing you change here is saved.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3" role="status" aria-live="polite">
        {crypto === "no" ? (
          <>
            <span className="rounded-pill border border-night-line px-4 py-1.5 text-base font-semibold text-on-night">Web Crypto is not available here</span>
            <span className="text-base text-on-night-soft">
              Browsers only offer it on https pages and localhost. The server checked this chain instead:{" "}
              {server.ok ? `verified, ${total} of ${total}.` : `broken at #${server.brokenAtSeq ?? "?"}.`}
            </span>
          </>
        ) : revealed && result && !result.ok ? (
          <>
            <span className="rounded-pill bg-stamp-red px-4 py-1.5 text-lg font-semibold text-on-plate">
              Broken at #{result.brokenAtSeq}. {after === 0 ? "It is the last link." : `The ${after} ${after === 1 ? "link" : "links"} after it ${after === 1 ? "fails" : "fail"} too.`}
            </span>
            <span className="text-base tabular-nums text-on-night-soft">
              {passing} of {total} links pass, recomputed in your browser in {took !== null ? ms(took) : "0"} ms
            </span>
          </>
        ) : revealed && result ? (
          <>
            <span className="rounded-pill bg-green-wash px-4 py-1.5 text-lg font-semibold text-stamp-green">
              Chain verified: {passing} of {total}
            </span>
            <span className="text-base tabular-nums text-on-night-soft">
              {passing} of {total} links verified in your browser in {took !== null ? ms(took) : "0"} ms
            </span>
          </>
        ) : result ? (
          <span className="text-base tabular-nums text-on-night-soft">
            {Math.min(shown, total)} of {total} links verified in your browser in {took !== null ? ms(took) : "0"} ms
          </span>
        ) : (
          <span className="text-base text-on-night-soft">
            {server.ok ? `The server verified all ${total} links.` : `The server found a break at #${server.brokenAtSeq ?? "?"}.`} Your browser re-checks them as this scrolls into view.
          </span>
        )}
      </div>

      <p className="mt-3 flex flex-wrap gap-x-3 text-xs text-on-night-soft">
        <span>
          Slip <span className="font-mono">{slipId}</span>
        </span>
        <span>{total} events</span>
      </p>

      <p id="chain-keys-hint" className="sr-only">
        Use arrow keys to move between links
      </p>
      <div role="group" aria-label={`Ledger chain, ${total} links`} aria-describedby="chain-keys-hint">
      <ol ref={grid} className="chain-grid mt-6" onKeyDown={onTileKey}>
        {effective.map((e, i) => {
          const state = stateOf(i);
          const edited = Boolean(edits[e.seq]);
          const link = links?.[i];
          const hash6 = (state === "bad" && link ? link.recomputed : e.hash).slice(0, 6);
          const title = describeEvent(e as unknown as LedgerEvent).title;
          const fail = state === "bad" || state === "cascade";
          return (
            <li key={e.seq} className="min-w-0">
              <button
                type="button"
                className="chain-tile w-full"
                data-state={state}
                data-cascade={fail ? "" : undefined}
                tabIndex={i === tabStop ? 0 : -1}
                onFocus={() => setRover(i)}
                aria-pressed={selected === e.seq}
                aria-label={`Event ${e.seq}, ${title}, hash ${hash6}, ${state === "pending" ? "not checked yet" : state === "ok" ? "verified" : state === "bad" ? "hash does not match" : "chain broken here"}`}
                title={title}
                style={{ "--i": fail && brokenIdx >= 0 ? Math.max(0, i - brokenIdx) : 0 } as React.CSSProperties}
                onClick={() => select(e.seq)}
              >
                <span className="flex items-baseline justify-between gap-1 text-xs font-semibold tabular-nums">
                  <span>#{e.seq}</span>
                  {edited ? <span className="font-normal">edited</span> : null}
                </span>
                <span className="chain-tile-type text-xs leading-tight">{tileLabel(e.type)}</span>
                <span className="font-mono text-xs">{hash6}</span>
              </button>
            </li>
          );
        })}
      </ol>
      </div>

      {crypto !== "no" && result ? (
        <div
          aria-hidden="true"
          className={`sticky bottom-0 z-[200] mt-4 flex min-h-11 items-center justify-between gap-x-3 rounded-md px-4 py-2 sm:hidden ${
            revealed && !result.ok ? "bg-stamp-red text-on-plate" : revealed ? "bg-pp-sky text-night" : "border-t border-night-line bg-night text-on-night"
          }`}
        >
          <span className="text-base font-semibold">
            {revealed && !result.ok ? `Broken at #${result.brokenAtSeq}` : revealed ? "Chain verified" : "Checking…"}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {revealed ? passing : Math.min(shown, total)} of {total} links
          </span>
        </div>
      ) : null}

      {crypto !== "no" ? (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-extrabold tracking-tight text-on-night">Tamper with it</h3>
            <div className="mt-4 flex flex-wrap gap-3">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`${BTN_NIGHT} whitespace-nowrap`}
                  disabled={crypto !== "yes"}
                  onClick={() => commit({ [p.seq]: p.edit }, p.seq)}
                >
                  {p.label}
                </button>
              ))}
              <button type="button" className={BTN_INVERT} disabled={!tampered} onClick={restore}>
                Restore the real ledger
              </button>
            </div>
            {sel ? (
              <div className="mt-6">
                <p className="text-base font-semibold text-on-night">
                  <span className="font-mono font-normal">#{sel.seq}</span> {describeEvent(sel as unknown as LedgerEvent).title}
                </p>
                <dl className="mt-3 space-y-3">
                  <HashLine label="Stored hash" hash={sel.hash} against={sel.hash} tone="stored" />
                  <HashLine label="Recomputed hash" hash={selLink && selIdx < shown ? selLink.recomputed : "Not checked yet"} against={sel.hash} tone="recomputed" />
                </dl>
                <p className="mt-3 text-sm text-on-night-soft">{selNote}</p>
              </div>
            ) : (
              <p className="mt-6 text-base text-on-night-soft">Pick a tile to see its hashes and edit its data.</p>
            )}
          </div>
          <div className="min-w-0">
            {sel ? (
              <>
                <label htmlFor="chain-lab-edit" className="text-sm font-semibold text-on-night">
                  Edit this event: its data as canonical JSON
                </label>
                <textarea
                  id="chain-lab-edit"
                  className="field mt-2 block h-56 w-full px-4 py-2.5 font-mono text-xs text-ink"
                  spellCheck={false}
                  value={draft}
                  onChange={(ev) => {
                    setDraft(ev.target.value);
                    setDraftError(null);
                  }}
                  aria-describedby={draftError ? "chain-lab-edit-error" : undefined}
                  aria-invalid={draftError ? true : undefined}
                />
                {draftError ? (
                  <p id="chain-lab-edit-error" role="alert" className="mt-2 text-sm font-semibold text-on-night">
                    <span className="rounded-pill bg-stamp-red px-3 py-0.5 text-xs text-on-plate">Invalid JSON</span> <span className="font-normal text-on-night-soft">{draftError}</span>
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className={BTN_INVERT} disabled={crypto !== "yes"} onClick={applyDraft}>
                    Apply and recompute
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
