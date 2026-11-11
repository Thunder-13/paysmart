/** The empty board: no bounties yet, so it shows how a bounty slip runs, in the pipeline's real steps. */
const STEPS: { title: string; body: string; chips: string[]; mono: boolean }[] = [
  {
    title: "Backers pledge",
    body: "Each pledge is its own slip. PayPal holds the money with an Orders v2 AUTHORIZE order. Nothing is charged.",
    chips: ["budget_max", "expires_at"],
    mono: true,
  },
  {
    title: "A hunter claims the job",
    body: "A clause is added to the pool slip so it can pay only the hunter's PayPal email.",
    chips: ["payee_allowlist"],
    mono: true,
  },
  {
    title: "A photo proves the work",
    body: "Before and after photos go to the guard, which checks them against the slip's evidence clause.",
    chips: ["require_evidence"],
    mono: true,
  },
  {
    title: "Payouts pays the hunter",
    body: "PayPal captures the pledges and Payouts v1 sends the reward. Anything unused is voided.",
    chips: ["Payments v2 capture", "Payouts v1", "Payments v2 void"],
    mono: false,
  },
];

export function EmptyState() {
  return (
    <div className="flex h-full flex-col rounded-card border border-dashed border-edge p-6 sm:p-8">
      <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">No bounties yet</h2>
      <p className="mt-1 text-base text-ink-soft">Post the first one. This is how its slip will run.</p>
      <ol className="mt-6 flex flex-1 flex-col justify-between gap-y-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-pill bg-ink text-sm font-semibold tabular-nums text-on-night">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{s.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{s.body}</p>
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Clauses and APIs">
                {s.chips.map((c) => (
                  <li key={c} className={`rounded-xs bg-paper-deep px-2 py-0.5 text-xs font-semibold text-ink ${s.mono ? "font-mono" : ""}`}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default EmptyState;
