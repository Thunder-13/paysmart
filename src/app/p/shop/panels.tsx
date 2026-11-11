"use client";
/** Wait panels for the shop run: slip review (clause editor), cart approval, delivery photo. */
import Image from "next/image";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Clause, Money, Verdict } from "@/core/contracts";
import { formatMoney, money } from "@/core/money";
import { FileDrop } from "@/components/file-drop";
import { MoneyTag } from "@/components/money-tag";
import { VerdictStamp } from "@/components/verdict-stamp";
import { SAMPLE_PHOTO_BASE64, SAMPLE_PHOTO_CONTENT_TYPE } from "@/pipelines/shop/sample-photo";
import type { AffiliateRecord, Attestation, CartLine, HelperRecord, RuledOut, ShopOption } from "@/pipelines/shop/types";
import type { ParsedVoiceCommand } from "@/pipelines/shop/voice";
import { ListenForApproval } from "./voice-controls";

const PANEL = "rounded-card border border-pp-gold bg-pp-gold-wash p-5 sm:p-6";
const WAITING = "text-sm font-semibold text-stamp-amber";
const PRIMARY =
  "inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY =
  "inline-flex h-11 items-center rounded-pill border border-stamp-red bg-card px-5 text-sm font-semibold text-stamp-red transition-colors duration-[120ms] hover:bg-red-wash active:bg-red-wash disabled:cursor-not-allowed disabled:opacity-55";
const QUIET =
  "inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55";
const TEXT_ACTION =
  "font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep disabled:cursor-not-allowed disabled:opacity-55";
const INPUT = "field h-11 px-4 text-base text-ink disabled:cursor-not-allowed disabled:opacity-55";

type Send = (signal: unknown) => Promise<void>;

function useSender(send: Send) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  async function run(signal: unknown) {
    setState({ busy: true, error: null });
    try {
      await send(signal);
      setState({ busy: false, error: null });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ...state, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-sm text-stamp-red">
      {error}
    </p>
  ) : null;
}

const REMOVABLE = new Set<Clause["kind"]>(["quantity_max", "category_in", "deliver_by", "exclude_attribute"]);

/** Review the compiled slip: change the budget, drop optional clauses, approve or tear it up. */
export function SlipReviewPanel({ message, clauses, onSend }: { message: string; clauses: Clause[]; onSend: Send }) {
  const budgetClause = clauses.find((c): c is Extract<Clause, { kind: "budget_max" }> => c.kind === "budget_max");
  const [budget, setBudget] = useState(budgetClause && budgetClause.amount.value !== "0.00" ? budgetClause.amount.value : "");
  const [dropped, setDropped] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const sender = useSender(onSend);

  function approve() {
    let amount: Money;
    try {
      amount = money(budget || "0");
    } catch {
      setLocalError("Type the spending limit as a number, like 60 or 42.50.");
      return;
    }
    setLocalError(null);
    const edited = clauses
      .filter((c) => !dropped.includes(c.id))
      .map((c) => (c.kind === "budget_max" ? { ...c, amount } : c));
    void sender.run({ approved: true, clauses: edited });
  }

  return (
    <section className={PANEL} aria-label="Review your slip">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="text-sm text-ink">
          <span className="block text-sm font-semibold text-ink-soft">Spending limit (USD)</span>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={`${INPUT} mt-1.5 w-36 font-semibold tabular-nums`}
            aria-describedby="slip-budget-help"
          />
        </label>
        <p id="slip-budget-help" className="pb-2.5 text-xs text-ink-soft">
          PayPal holds exactly this much. The agent can&apos;t go past it.
        </p>
      </div>
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-ink-soft">Clauses to keep</legend>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {clauses.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 py-2.5 text-base text-ink">
                <input
                  type="checkbox"
                  className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-pp-blue disabled:cursor-not-allowed"
                  checked={!dropped.includes(c.id)}
                  disabled={!REMOVABLE.has(c.kind)}
                  onChange={(e) => setDropped((d) => (e.target.checked ? d.filter((x) => x !== c.id) : [...d, c.id]))}
                />
                <span>
                  <span className="mr-1.5 inline-block rounded-xs bg-paper-deep px-2 font-mono text-xs font-semibold text-ink-soft">{c.id}</span> {c.label}
                  {!REMOVABLE.has(c.kind) ? <span className="text-xs text-ink-faint"> (required)</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={PRIMARY} disabled={sender.busy} onClick={approve}>
          Approve slip
        </button>
        <button type="button" className={SECONDARY} disabled={sender.busy} onClick={() => void sender.run({ approved: false })}>
          Tear it up
        </button>
      </div>
      <ErrorLine error={localError ?? sender.error} />
    </section>
  );
}

interface CartTotals {
  goods: Money;
  helperFee: Money;
  capture: Money;
  release: Money;
}

const FIELD_WORDS: Record<string, string> = {
  deliveryEstimate: "Delivery date",
  inStock: "In stock",
  category: "Category",
  itemCount: "Units per listing",
};

/** One option as the cart wait sends it: the option plus its own capture and release figures. */
export type OptionView = ShopOption & { totals: CartTotals };

const BADGE: Record<Verdict["decision"], { word: string; holder: string; ink: string }> = {
  within: { word: "WITHIN SLIP", holder: "bg-pp-sky", ink: "text-night" },
  ask: { word: "NEEDS YOUR CALL", holder: "bg-pp-gold", ink: "text-night" },
  outside: { word: "OUTSIDE SLIP", holder: "bg-stamp-red", ink: "text-on-plate" },
};

/** The stamped word, as it sits in a strip's coloured holder. */
function Badge({ decision }: { decision: Verdict["decision"] }) {
  const b = BADGE[decision];
  return (
    <span className={`inline-block rounded-sm border-[3px] border-current p-0.5 ${b.ink}`}>
      <span className="block rounded-xs border border-current px-2 py-1.5 font-display text-sm font-black leading-none">{b.word}</span>
    </span>
  );
}

function ids(list: string[]): string {
  return list.join(", ");
}

/** The clause ids a stamp cites: the facts the guard still needs for ASK, otherwise the clauses it cleared. */
function citedLine(verdict: Verdict, clauseIds: string[]): string {
  if (verdict.decision === "ask") return `Needs you: ${ids([...new Set(verdict.unknowns.map((u) => u.clauseId))])}`;
  return clauseIds.length ? `Cleared: ${ids(clauseIds)}` : "Cleared every clause";
}

function webUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Live listings link out (through the affiliate URL when there is one). Sample and planted listings show the URL as text. */
function ShopLink({ line }: { line: CartLine }) {
  const url = webUrl(line.affiliate?.url ?? line.url);
  if (!url) return null;
  if (line.source === "channel3") {
    return (
      <a href={url} target="_blank" rel="sponsored noopener noreferrer" className={`text-xs ${TEXT_ACTION}`}>
        View at {line.domain}
      </a>
    );
  }
  return (
    <span className="text-xs text-ink-soft">
      Sample shop link: <span className="break-all font-mono">{url}</span>
    </span>
  );
}

export const AFFILIATE_DISCLOSURE = "Retailer links carry our affiliate ID. We may earn a commission from the retailer. It doesn't change your price or the guard's verdict.";

function hasAffiliate(options: { lines: CartLine[] }[]): boolean {
  return options.some((o) => o.lines.some((l) => l.affiliate));
}

function optionTitle(o: ShopOption): string {
  return o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.title}` : l.title)).join(" + ");
}

/**
 * The carts the guard stamped WITHIN or ASK, as a radio group of slip cards. Arrow keys move the
 * selection. The agent's note is shown as the agent's own words and labelled as unchecked.
 */
export function OptionsPanel({
  options,
  ruledOut,
  selectedId,
  clauseIds,
  disabled,
  onSelect,
}: {
  options: OptionView[];
  ruledOut: RuledOut[];
  selectedId: string;
  clauseIds: string[];
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const base = useId();
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  function move(from: number, step: number) {
    const next = (from + step + options.length) % options.length;
    onSelect(options[next].id);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, i: number) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(i, -1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onSelect(options[i].id);
    }
  }

  return (
    <div className="mt-5">
      <p id={`${base}-label`} className="text-sm font-semibold text-ink">
        Carts the guard checked ({options.length})
      </p>
      <div role="radiogroup" aria-labelledby={`${base}-label`} aria-describedby={`${base}-hint`} className="mt-3 space-y-3">
        {options.map((o, i) => {
          const checked = o.id === selectedId;
          const look = BADGE[o.verdict.decision];
          return (
            <div key={o.id} className={`overflow-hidden rounded-card border-2 bg-card ${checked ? "border-ink" : "border-line"}`}>
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                aria-labelledby={`${base}-${o.id}-title`}
                aria-describedby={`${base}-${o.id}-desc`}
                tabIndex={checked ? 0 : -1}
                onClick={() => (disabled ? undefined : onSelect(o.id))}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`grid grid-cols-[minmax(0,1fr)] cursor-pointer transition-colors duration-[120ms] focus-visible:-outline-offset-4 sm:grid-cols-[minmax(11rem,13rem)_minmax(0,1fr)] ${checked ? "" : "hover:bg-paper-deep active:bg-line"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 sm:col-start-2 sm:row-start-1">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="10" cy="10" r="7.5" className={checked ? "text-pp-blue" : "text-edge"} />
                        {checked ? <circle cx="10" cy="10" r="4" fill="currentColor" stroke="none" className="text-pp-blue" /> : null}
                      </svg>
                      Option {o.rank}
                    </p>
                    <p id={`${base}-${o.id}-title`} className="mt-1 text-base font-semibold text-ink">
                      {optionTitle(o)}
                    </p>
                    <p className="text-xs text-ink-soft">Sold by {[...new Set(o.lines.map((l) => l.domain))].join(", ")}</p>
                  </div>
                  <span className="text-2xl">
                    <MoneyTag money={o.proposal.amount} />
                  </span>
                </div>
                <div id={`${base}-${o.id}-desc`} className="contents">
                  <div className={`order-first flex flex-col items-start justify-center gap-2 px-5 py-4 sm:order-none sm:col-start-1 sm:row-span-2 sm:row-start-1 ${look.holder} ${look.ink}`}>
                    <Badge decision={o.verdict.decision} />
                    <p className="text-xs font-semibold">{citedLine(o.verdict, clauseIds)}</p>
                  </div>
                  <div className="space-y-2 px-5 pb-4 pt-2 sm:col-start-2 sm:row-start-2">
                    <p className="text-xs text-ink-soft">
                      Captures {formatMoney(o.totals.capture)}, releases {formatMoney(o.totals.release)}
                    </p>
                    {o.rationale ? (
                      <p className="rounded-md bg-paper-deep px-4 py-3 text-sm text-ink">
                        <span className="block text-xs text-ink-soft">Agent&apos;s note (not checked by the guard)</span>
                        {o.rationale}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 border-t border-line px-5 py-2 empty:hidden">
                {o.lines.map((l) => (
                  <ShopLink key={l.listingId} line={l} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {hasAffiliate(options) ? <p className="mt-3 text-xs text-ink-soft">{AFFILIATE_DISCLOSURE}</p> : null}
      <p id={`${base}-hint`} className="mt-1 text-xs text-ink-faint">
        Use the arrow keys to move between options, or say &quot;option two&quot;.
      </p>
      {ruledOut.length ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-stamp-red">Ruled out by the guard</p>
          <ul className="mt-3 space-y-2">
            {ruledOut.map((r, i) => (
              <li key={`${r.title}-${i}`} className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card border border-line bg-card sm:grid-cols-[minmax(11rem,13rem)_minmax(0,1fr)]">
                <div className={`flex items-center px-5 py-3 ${BADGE.outside.holder} ${BADGE.outside.ink}`}>
                  <Badge decision="outside" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{r.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      <span>Broke:</span>
                      {r.clauseIds.map((cid) => (
                        <span key={cid} className="rounded-xs bg-stamp-red px-2 py-0.5 font-mono font-semibold text-on-plate">
                          {cid}
                        </span>
                      ))}
                    </p>
                  </div>
                  <span className="text-xl">
                    <MoneyTag money={r.amount} tone="muted" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Choose a cart (click, keyboard or voice) and approve it, or confirm unknown facts when the guard asks. */
export function CartPanel({
  message,
  options,
  ruledOut,
  selectedOptionId,
  clauseIds,
  helper,
  onSend,
}: {
  message: string;
  options: OptionView[];
  ruledOut: RuledOut[];
  selectedOptionId: string | null;
  clauseIds: string[];
  helper: HelperRecord | null;
  onSend: Send;
}) {
  const [selectedId, setSelectedId] = useState(selectedOptionId ?? options[0]?.id ?? "");
  const sel = options.find((o) => o.id === selectedId) ?? options[0];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const sender = useSender(onSend);
  const many = options.length > 1;
  const fields = [...new Set((sel?.verdict.unknowns ?? []).map((u) => u.field))];

  if (!sel) return null;

  function attestations(): Attestation[] {
    return fields
      .filter((f) => (answers[f] ?? "") !== "")
      .map((f) => {
        const raw = answers[f];
        const value = f === "itemCount" ? Number.parseInt(raw, 10) : f === "inStock" ? raw === "yes" : raw;
        return { field: f, value };
      });
  }

  function approve(via: "click" | "keyboard" | "voice") {
    void sender.run({ approved: true, optionId: sel.id, via, attestations: fields.length ? attestations() : undefined });
  }

  async function onVoice(cmd: ParsedVoiceCommand) {
    if (cmd.kind === "choose_option") {
      const picked = options[cmd.index - 1];
      if (!picked) throw new Error(`There is no option ${cmd.index}. Say a number from 1 to ${options.length}.`);
      setSelectedId(picked.id);
    } else if (cmd.kind === "approve_cart") approve("voice");
    else await sender.run({ approved: false, via: "voice" });
  }

  const totals = sel.totals;
  const label = many ? `Approve option ${sel.rank}` : "Approve cart";

  return (
    <section className={PANEL} aria-label={many ? "Choose and approve a cart" : "Approve the cart"}>
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      {many ? <OptionsPanel options={options} ruledOut={ruledOut} selectedId={sel.id} clauseIds={clauseIds} disabled={sender.busy} onSelect={setSelectedId} /> : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Option ${sel.rank} selected. ${BADGE[sel.verdict.decision].word}. ${citedLine(sel.verdict, clauseIds)}. Captures ${formatMoney(totals.capture)}.`}
      </p>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {sel.lines.map((l) => (
          <li key={l.listingId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-base">
            <span className="flex flex-wrap items-baseline gap-x-3 text-ink">
              <span>
                {l.quantity} × {l.title}
              </span>
              <span className="text-xs text-ink-soft">{l.domain}</span>
            </span>
            <span className="text-lg">
              <MoneyTag money={l.unitPrice} />
            </span>
          </li>
        ))}
        {helper && helper.accepted ? (
          <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-base">
            <span className="flex flex-wrap items-baseline gap-x-3 text-ink">
              <span>Card message by {helper.helperName}</span>
              <span className="text-xs text-ink-soft">paid at checkout</span>
            </span>
            <span className="text-lg">
              <MoneyTag money={helper.fee} />
            </span>
          </li>
        ) : null}
      </ul>
      <VerdictStamp key={sel.id} verdict={sel.verdict} className="mt-3" caption={`${many ? `Option ${sel.rank}: ` : ""}cart total ${formatMoney(totals.goods)}`} />
      <ul role="list" className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-3xl">
        <li><MoneyTag money={totals.capture} label="Will be captured" /></li>
        <li><MoneyTag money={totals.release} label="Will be released" tone="green" /></li>
      </ul>
      {!many ? (
        <div className="mt-3 flex flex-col gap-1">
          {sel.lines.map((l) => (
            <ShopLink key={l.listingId} line={l} />
          ))}
          {hasAffiliate(options) ? <p className="text-xs text-ink-soft">{AFFILIATE_DISCLOSURE}</p> : null}
        </div>
      ) : null}
      {!many && ruledOut.length ? (
        <p className="mt-2 text-xs text-ink-soft">
          Ruled out by the guard: {ruledOut.map((r) => `${r.title} (${ids(r.clauseIds)})`).join("; ")}
        </p>
      ) : null}
      {fields.length ? (
        <fieldset className="mt-5 space-y-3">
          <legend className="text-sm font-semibold text-ink">The guard needs you to confirm</legend>
          {fields.map((f) => {
            const id = `attest-${f.replace(/\W/g, "-")}`;
            const label = FIELD_WORDS[f] ?? f.replace(/^attributes\./, "").replace(/_/g, " ");
            return (
              <div key={f} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label htmlFor={id} className="w-40 text-sm text-ink">
                  {label}
                </label>
                {f === "inStock" ? (
                  <select
                    id={id}
                    value={answers[f] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f]: e.target.value }))}
                    className={`${INPUT} min-w-32`}
                  >
                    <option value="">Choose</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <input
                    id={id}
                    type={f === "deliveryEstimate" ? "date" : f === "itemCount" ? "number" : "text"}
                    value={answers[f] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f]: e.target.value }))}
                    className={`${INPUT} min-w-32`}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} disabled={sender.busy} onClick={(e) => approve(e.detail === 0 ? "keyboard" : "click")}>
          {label}
        </button>
        <button type="button" className={SECONDARY} disabled={sender.busy} onClick={() => void sender.run({ approved: false })}>
          Decline cart
        </button>
        <ListenForApproval enabled={!sender.busy} onCommand={onVoice} />
      </div>
      <ErrorLine error={sender.error} />
    </section>
  );
}

/** Upload the delivery photo, use the bundled sample, or skip the check. */
export function DeliveryPanel({ message, accept, onSend }: { message: string; accept: string; onSend: Send }) {
  const sender = useSender(onSend);
  return (
    <section className={PANEL} aria-label="Delivery photo">
      <p className={WAITING}>Waiting for you</p>
      <p className="mt-1 text-base text-ink">{message}</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <FileDrop accept={accept} disabled={sender.busy} label="Drop the delivery photo here or choose one" onUploaded={(f) => void sender.run({ ref: f.ref, contentType: f.contentType })} />
        <div className="flex flex-col items-start gap-2">
          <Image
            src={`data:${SAMPLE_PHOTO_CONTENT_TYPE};base64,${SAMPLE_PHOTO_BASE64}`}
            alt="Sample delivery photo: the wind-up T-rex in its box next to a battery pack"
            width={160}
            height={110}
            unoptimized
            className="h-auto w-40 rounded-md border border-line"
          />
          <button type="button" className={QUIET} disabled={sender.busy} onClick={() => void sender.run({ sample: true })}>
            Use sample photo
          </button>
          <button type="button" className={`text-sm ${TEXT_ACTION}`} disabled={sender.busy} onClick={() => void sender.run({ skip: true })}>
            Skip the delivery check
          </button>
        </div>
      </div>
      <ErrorLine error={sender.error} />
    </section>
  );
}

/** Estimated commission for the money panel: struck through when a refund reversed it. */
export function CommissionLine({ affiliate }: { affiliate: AffiliateRecord }) {
  if (!affiliate.estCommission) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs text-ink-soft">Estimated commission</p>
      <p className={`text-2xl ${affiliate.reversed ? "line-through decoration-2" : ""}`}>
        <MoneyTag money={affiliate.estCommission} tone={affiliate.reversed ? "muted" : "green"} />
      </p>
      <p className="text-xs text-ink-soft">{affiliate.reversed ? "Reversed by the refund." : "An estimate. The retailer decides what it pays."}</p>
    </div>
  );
}
