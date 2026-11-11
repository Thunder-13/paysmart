import type { GiveResult, UpstreamResult } from "@/pipelines/cash-weather/types";
import { MoneyTag } from "@/components/money-tag";
import { percent } from "@/pipelines/cash-weather/upstream";

function safeLink(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/** Who gets what: packages with their real npm handles, then the receivers and their share. */
export function UpstreamTable({ upstream, give }: { upstream: UpstreamResult; give: GiveResult | null }) {
  const amountFor = new Map((give?.payouts ?? []).map((p) => [p.handle, p]));
  return (
    <div className="space-y-6">
      <p className="max-w-[65ch] text-base text-ink">{upstream.explanation}</p>
      <div tabIndex={0} role="region" aria-label="Direct dependencies" className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full text-left text-sm">
          <caption className="px-5 pb-1 pt-4 text-left text-sm font-semibold text-ink">
            Direct dependencies ({upstream.registryMode === "live" ? "live npm registry" : "offline npm data"})
          </caption>
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <th className="py-3 pl-5 pr-3 font-semibold">Package</th>
              <th className="py-3 pr-3 font-semibold">npm maintainers</th>
              <th className="py-3 pr-3 text-right font-semibold">Weight</th>
              <th className="py-3 pr-5 font-semibold">Funding</th>
            </tr>
          </thead>
          <tbody>
            {upstream.packages.map((p) => {
              const link = safeLink(p.funding);
              return (
                <tr key={p.name} className="border-t border-line align-top first:border-t-0" data-package={p.name}>
                  <td className="py-3 pl-5 pr-3">
                    <span className="font-mono">{p.name}</span>
                    {p.offline ? <span className="ml-2 text-xs text-stamp-amber">offline data</span> : null}
                  </td>
                  <td className="py-3 pr-3">
                    {p.maintainers.length === 0 ? <span className="text-ink-faint">unknown</span> : null}
                    {p.maintainers.map((m) => (
                      <span key={m} className={`mr-2 inline-block font-mono text-xs ${p.mapped.includes(m) ? "text-ink" : "text-ink-faint"}`}>
                        @{m}
                      </span>
                    ))}
                    {!p.route ? <span className="block text-xs text-stamp-amber">No payout route: nobody here has a receiver set up</span> : null}
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold tabular-nums">
                    {p.weight.toFixed(2)}
                    {p.importCount !== null ? <span className="block text-xs font-normal text-ink-faint">{p.importCount} imports</span> : null}
                  </td>
                  <td className="py-3 pr-5 text-xs">
                    {link ? (
                      <a
                        href={link}
                        rel="noopener noreferrer nofollow"
                        target="_blank"
                        className="font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep"
                      >
                        {new URL(link).hostname}
                      </a>
                    ) : (
                      <span className="text-ink-faint">none listed</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {upstream.receivers.length > 0 ? (
        <div tabIndex={0} role="region" aria-label="Receivers" className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full text-left text-sm">
            <caption className="px-5 pb-1 pt-4 text-left text-sm font-semibold text-ink">Receivers (sandbox accounts mapped to npm handles)</caption>
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="py-3 pl-5 pr-3 font-semibold">npm handle</th>
                <th className="py-3 pr-3 font-semibold">For</th>
                <th className="py-3 pr-3 text-right font-semibold">Share</th>
                <th className="py-3 pr-3 text-right font-semibold">Amount</th>
                <th className="py-3 pr-5 font-semibold">Receiver</th>
              </tr>
            </thead>
            <tbody>
              {upstream.receivers.map((r) => {
                const pay = amountFor.get(r.handle);
                return (
                  <tr key={r.handle} className="border-t border-line first:border-t-0" data-receiver={r.handle}>
                    <td className="py-3 pl-5 pr-3 font-mono">@{r.handle}</td>
                    <td className="py-3 pr-3 text-xs text-ink-soft">{r.packages.join(", ")}</td>
                    <td className="py-3 pr-3 text-right font-semibold tabular-nums">{percent(pay?.weightBps ?? r.weightBps)}</td>
                    <td className="py-3 pr-3 text-right">{pay ? <MoneyTag money={pay.amount} /> : <span className="text-xs text-ink-faint">none</span>}</td>
                    <td className="py-3 pr-5 font-mono text-xs text-ink-soft">{r.email}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-base text-ink-soft">No maintainer has a payout route, so nobody can be paid this month.</p>
      )}
      {upstream.rejected.length > 0 ? <p className="text-xs text-stamp-amber">Ignored names npm would not accept: {upstream.rejected.join(", ")}</p> : null}
    </div>
  );
}

export function GiveReasoning({ give }: { give: GiveResult }) {
  return (
    <div className="rounded-card border border-line bg-card p-5">
      <ol className="space-y-2 text-sm text-ink" aria-label="How the giving budget was worked out">
        {give.lines.map((line, i) => (
          <li key={i} className={i === give.lines.length - 1 ? "border-t border-line pt-3 text-base font-semibold" : "text-ink-soft"}>
            {line}
          </li>
        ))}
      </ol>
      <div className="mt-4 text-lg">
        <MoneyTag money={give.budget} label="Safe to give" tone={give.budget.value === "0.00" ? "muted" : "green"} />
      </div>
      {give.dropped.length > 0 ? <p className="mt-3 text-xs text-ink-soft">Left out (share under $1.00): {give.dropped.join(", ")}</p> : null}
    </div>
  );
}

export default UpstreamTable;
