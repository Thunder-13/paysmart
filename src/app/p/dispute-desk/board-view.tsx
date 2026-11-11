"use client";
import { MoneyTag } from "@/components/money-tag";
import type { Board, BoardCard } from "@/pipelines/dispute-desk/board";
import { decisionWords, TONE_CLASSES, urgencyChip } from "@/pipelines/dispute-desk/view";

export function UrgencyChip({ card }: { card: Pick<BoardCard, "urgency" | "hoursLeft"> }) {
  const chip = urgencyChip(card.urgency, card.hoursLeft);
  const t = TONE_CLASSES[chip.tone];
  return (
    <span className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${chip.solid ? `${t.solid} border-transparent` : `${t.border} ${t.text} bg-card`}`}>
      {chip.text}
    </span>
  );
}

function CardButton({ card, selected, onSelect }: { card: BoardCard; selected: boolean; onSelect: (card: BoardCard) => void }) {
  const decision = card.case?.decision ? decisionWords(card.case.decision) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      aria-pressed={selected}
      className={`w-full rounded-md border p-3 text-left transition-colors duration-[120ms] hover:border-ink focus-visible:outline-offset-2 active:bg-paper-deep ${selected ? "border-pp-blue bg-pp-sky-wash" : "border-line bg-card"}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold text-ink">{card.reasonLabel}</span>
        <MoneyTag money={card.amount} />
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <UrgencyChip card={card} />
        <span className={`rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${card.link.slipId ? "border-stamp-green text-stamp-green" : "border-line text-ink-faint"}`}>
          {card.link.slipId ? "Slip linked" : "No slip"}
        </span>
        {decision ? (
          <span className={`inline-block rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[decision.tone].border} ${TONE_CLASSES[decision.tone].text}`}>
            {decision.word.charAt(0) + decision.word.slice(1).toLowerCase()}
          </span>
        ) : null}
      </span>
      <span className="mt-2 block truncate font-mono text-xs text-ink-faint">{card.disputeId}</span>
    </button>
  );
}

/** Deadline board: one CSS grid column per PayPal status lane; empty lanes shrink to their header. */
export function BoardView({ board, selectedId, onSelect }: { board: Board; selectedId: string | null; onSelect: (card: BoardCard) => void }) {
  const columns = board.lanes.map((l) => (l.cards.length > 0 ? "minmax(14rem, 1fr)" : "minmax(7.5rem, 0.45fr)")).join(" ");
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid gap-3" style={{ gridTemplateColumns: columns }}>
        {board.lanes.map((lane) => (
          <section key={lane.id} aria-labelledby={`lane-${lane.id}`} className="rounded-card bg-paper-deep p-3">
            <h3 id={`lane-${lane.id}`} className="mb-3 flex items-baseline justify-between gap-2 px-1 text-sm font-semibold text-ink">
              <span>{lane.title}</span>
              <span className="tabular-nums text-ink-soft">{lane.cards.length}</span>
            </h3>
            {lane.cards.length === 0 ? (
              <p className="px-1 text-xs text-ink-soft">None</p>
            ) : (
              <ol className="space-y-2">
                {lane.cards.map((card) => (
                  <li key={card.disputeId}>
                    <CardButton card={card} selected={card.disputeId === selectedId} onSelect={onSelect} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
