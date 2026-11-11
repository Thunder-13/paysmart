/** Center column: what the agent did, card by card, from the slip's ledger events. */
import Image from "next/image";
import type { ExtractedFacts } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { MoneyTag } from "@/components/money-tag";
import { VerdictStamp } from "@/components/verdict-stamp";
import type { ActivityCard } from "@/pipelines/shop/activity";

/** Log entries are flat: a hairline rail on the left, no box. The guard stamps are the only loud rows. */
const CARD = "border-l-2 border-line pl-4";

function SourceBadge({ source }: { source: string }) {
  if (source === "planted") {
    return <span className="rounded-pill border border-stamp-red px-2.5 py-0.5 text-xs font-semibold text-stamp-red">Planted</span>;
  }
  if (source === "fixture") {
    return <span className="rounded-pill border border-edge px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Sample data</span>;
  }
  return null;
}

function factChips(f: ExtractedFacts | undefined): string[] {
  if (!f) return [];
  const chips: string[] = [];
  if (f.category) chips.push(`category: ${f.category}`);
  const power = f.attributes?.power_source;
  chips.push(`power: ${power === null || power === undefined ? "unknown" : String(power).replace(/_/g, "-")}`);
  chips.push(`arrives: ${f.deliveryEstimate ?? "unknown"}`);
  chips.push(`units: ${f.itemCount ?? "unknown"}`);
  if (f.inStock !== null) chips.push(f.inStock ? "in stock" : "out of stock");
  return chips;
}

function cartCaption(c: Extract<ActivityCard, { kind: "verdict" }>): string {
  const items = c.proposal.items.map((i) => `${i.quantity} × ${i.title}`).join(", ");
  const amount = c.proposal.amount ? formatMoney(c.proposal.amount) : "";
  const what = c.proposal.kind === "purchase" ? "Cart" : c.proposal.kind === "child_slip" ? "Helper slip" : c.proposal.kind === "payout" ? "Payout" : "Proposal";
  return `${what}: ${items || amount}${items && amount ? ` for ${amount}` : ""}`;
}

function CardView({ card }: { card: ActivityCard }) {
  switch (card.kind) {
    case "say":
      return (
        <div className="flex gap-3">
          <span aria-hidden="true" className="mt-0.5 h-7 w-7 shrink-0 rounded-pill bg-ink text-center text-xs font-semibold leading-7 text-on-night">
            A
          </span>
          <p className="min-w-0 rounded-md bg-paper-deep px-4 py-2.5 text-base text-ink">
            <span className="sr-only">Agent: </span>
            {card.text}
          </p>
        </div>
      );
    case "search":
      return (
        <section className={CARD} aria-label={`Search: ${card.query}`}>
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-ink">
            <span>
              Searched <q className="font-semibold">{card.query}</q>
            </span>
            <span className="text-xs text-ink-soft">{card.source === "channel3" ? "Channel3" : "sample catalog"}</span>
            {card.maxPrice ? <span className="text-xs text-ink-soft">{`up to ${formatMoney(card.maxPrice)}`}</span> : null}
          </p>
          {card.error ? (
            <p role="alert" className="mt-2 text-sm text-stamp-red">
              {card.error}
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              {card.results.map((r) => (
                <li key={r.id} className={`rounded-md px-4 py-3 ${r.source === "planted" ? "bg-red-wash" : "bg-paper-deep"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug text-ink">{r.title}</p>
                    <MoneyTag money={r.price} />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    <span>{r.domain}</span>
                    <SourceBadge source={r.source} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    case "inspect":
      return (
        <section className={CARD} aria-label={`Inspected ${card.title}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm text-ink">
              Inspected <span className="font-semibold">{card.title}</span> <SourceBadge source={card.source} />
            </p>
            {card.price ? <MoneyTag money={card.price} /> : null}
          </div>
          {card.excerpt ? <p className="mt-2 text-sm text-ink-soft">{card.excerpt}</p> : null}
          <p className="mt-3 text-xs font-semibold text-ink-soft">Facts the guard sees</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Extracted facts">
            {factChips(card.facts).map((chip) => (
              <li key={chip} className="rounded-pill bg-paper-deep px-2.5 py-0.5 text-xs text-ink">
                {chip}
              </li>
            ))}
            {card.facts?.injectionSuspected ? (
              <li className="rounded-pill bg-red-wash px-2.5 py-0.5 text-xs font-semibold text-stamp-red">integrity: injection suspected</li>
            ) : null}
          </ul>
          {card.hidden.length > 0 ? (
            <div className="mt-4 rounded-md bg-red-wash p-4">
              <p className="text-sm font-semibold text-stamp-red">Hidden instructions found</p>
              {card.hidden.map((h) => (
                <blockquote key={h} className="mt-1 text-sm leading-relaxed text-ink">
                  {h}
                </blockquote>
              ))}
              <p className="mt-2 text-xs text-ink-soft">The agent read this text. The guard never does; it only sees the facts above.</p>
            </div>
          ) : null}
        </section>
      );
    case "verdict":
      return <VerdictStamp verdict={card.verdict} caption={`${cartCaption(card)} (ledger #${card.seq})`} />;
    case "helper":
      return (
        <section className="border-l-2 border-dashed border-edge pl-4" aria-label={`Helper: ${card.helperName}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink">
              Hired <span className="font-semibold">{card.helperName}</span> on a helper slip
            </p>
            {card.fee ? <MoneyTag money={card.fee} label="Fee" /> : null}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
            <span>
              Brief: <q>{card.brief}</q>
            </span>
            <span>pays {card.payee}</span>
          </p>
          {card.message ? <p className="mt-3 rounded-md bg-paper-deep px-4 py-3 text-base text-ink">&ldquo;{card.message}&rdquo;</p> : null}
          {card.judged ? (
            <p className="mt-3 flex flex-wrap gap-x-3 text-sm">
              <span className={`font-semibold ${card.judged.verdict === "pass" ? "text-stamp-green" : "text-stamp-red"}`}>Rubric {card.judged.verdict === "pass" ? "pass" : "fail"}</span>
              <span className="text-ink-soft">{card.judged.detail}</span>
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
            {card.stage === "paid" ? (
              <>
                <span>Paid through Payouts</span>
                {card.payoutBatchId ? <span className="font-mono">{`batch ${card.payoutBatchId}`}</span> : null}
                <span>The fee is in the final capture.</span>
              </>
            ) : card.stage === "unpaid"
                ? "Not paid. The helper slip was closed."
                : card.judged?.verdict === "pass"
                  ? "Paid at checkout, after you approve the cart."
                  : card.judged
                    ? "Not paid. The helper slip was closed."
                    : "Working…"}
          </p>
        </section>
      );
    case "attest":
      return (
        <p className="text-sm text-ink">
          You confirmed <span className="font-mono">{card.field}</span> = <span className="font-mono">{String(card.value)}</span>
        </p>
      );
    case "money":
      return (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
          <span className="font-semibold">{card.what === "captured" ? "Captured" : card.what === "refunded" ? "Refunded" : "Hold voided"}</span>
          {card.amount ? <MoneyTag money={card.amount} tone={card.what === "refunded" ? "green" : "neutral"} /> : null}
          {card.detail ? <span className="text-ink-soft">{card.detail}</span> : null}
        </p>
      );
    case "delivery": {
      const breached = card.check.breaches.length > 0;
      return (
        <section className={`border-l-2 pl-4 ${breached ? "border-stamp-red" : "border-stamp-green"}`} aria-label="Delivery check">
          <div className="flex flex-wrap gap-4">
            {card.photoRef ? (
              <Image
                src={`/api/p/shop/photo?ref=${encodeURIComponent(card.photoRef)}`}
                alt={card.sample ? "Sample delivery photo: the wind-up T-rex with a battery pack in the box" : "Your delivery photo"}
                width={192}
                height={132}
                unoptimized
                className="h-auto w-48 rounded-md border border-line"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap gap-x-3 text-sm">
                <span className={`font-semibold ${breached ? "text-stamp-red" : "text-stamp-green"}`}>
                  {breached ? `Breach: ${card.check.breaches.map((b) => b.clauseId).join(", ")}` : "Matches the slip"}
                </span>
                <span className="text-ink-soft">confidence {card.check.confidence}</span>
              </p>
              <p className="mt-1 text-sm text-ink">{card.check.summary}</p>
              <ul className="mt-2 space-y-1 text-sm text-stamp-red">
                {card.check.breaches.map((b) => (
                  <li key={b.clauseId} className="flex flex-wrap gap-x-3">
                    <span className="font-mono font-semibold">{b.clauseId}</span>
                    <span>{b.observation}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      );
    }
    case "outcome":
      return (
        <p className="flex flex-wrap gap-x-3 rounded-md bg-paper-deep px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Outcome: {card.outcome.replace(/_/g, " ")}</span>
          {card.note ? <span className="text-ink-soft">{card.note}</span> : null}
        </p>
      );
  }
}

export function ActivityStream({ cards }: { cards: ActivityCard[] }) {
  if (cards.length === 0) {
    return <p className="text-sm text-ink-faint">The agent&apos;s searches, the facts it read and every guard stamp show up here.</p>;
  }
  return (
    <ol className="space-y-5" aria-label="Agent activity">
      {cards.map((c) => (
        <li key={c.key} className={c.kind === "verdict" ? "motion-safe:rack-in" : "motion-safe:animate-fade-in"}>
          <CardView card={c} />
        </li>
      ))}
    </ol>
  );
}
