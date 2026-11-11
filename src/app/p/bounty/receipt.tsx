import { MoneyTag } from "@/components/money-tag";
import type { Bounty } from "@/pipelines/bounty/schema";

/** Payout receipt: the PayPal Payouts batch, who got paid, and what each backer was charged. */
export function Receipt({ bounty }: { bounty: Bounty }) {
  const payout = bounty.payout;
  if (!payout) return null;
  return (
    <section aria-label="Payout receipt" className="rounded-md bg-green-wash p-5">
      <div className="flex items-center gap-2 text-stamp-green">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M6.2 10.2l2.6 2.6 5-5.4" />
        </svg>
        <p className="text-sm font-semibold">Paid through PayPal Payouts</p>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <MoneyTag money={payout.amount} tone="green" className="text-4xl leading-none" />
        <span className="text-sm text-ink">
          to {bounty.claim?.workerName ?? "the worker"} ({payout.receiverEmail})
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 border-t border-line text-sm">
        <dt className="border-b border-line py-2 text-ink-soft">Batch</dt>
        <dd className="min-w-0 break-all border-b border-line py-2 font-mono text-ink">{payout.batchId}</dd>
        <dt className="py-2 text-ink-soft">Status</dt>
        <dd className="py-2 font-mono text-ink">{payout.status}</dd>
      </dl>
      {bounty.captures.length > 0 ? (
        <>
          <p className="mt-3 text-sm font-semibold text-ink">Backers charged</p>
          <ul className="mt-1 divide-y divide-line text-sm">
            {bounty.captures.map((c) => (
              <li key={c.captureId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="text-ink">{c.backer}</span>
                <MoneyTag money={c.amount} className="ml-auto" />
                <span className="w-full break-all text-xs text-ink-faint">
                  capture <span className="font-mono">{c.captureId}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export default Receipt;
