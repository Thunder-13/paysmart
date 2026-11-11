import { connection } from "next/server";
import { ActorIcon } from "@/components/actor-icon";
import { ChainLab } from "@/components/chain-lab";
import { describeEvent } from "@/components/event-text";
import { shortTime } from "@/components/slip-figures";
import { chainLab } from "@/server/chain-lab";
import { featuredRuns } from "@/server/featured-runs";
import { consoleFigures, type ChainFigures } from "@/server/ledger-figures";
import { getRuntime } from "@/server/runtime";
import { plural } from "./shared";

function ChainBadge({ chain }: { chain: ChainFigures }) {
  if (chain.slips === 0) {
    return (
      <p className="text-base text-on-night-soft" role="status">
        No ledger events yet. The chain check starts with the first slip.
      </p>
    );
  }
  if (chain.ok) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-3 text-base">
        <span className="rounded-pill bg-pp-sky px-3.5 py-1 text-sm font-semibold text-night">Chain verified</span>
        <span className="text-on-night-soft">
          {plural(chain.slips, "slip")}, {plural(chain.events, "event")}, every hash checked just now
        </span>
      </p>
    );
  }
  return (
    <div role="status" className="text-base">
      <span className="rounded-pill bg-stamp-red px-3.5 py-1 text-sm font-semibold text-on-plate">Chain broken on {plural(chain.broken.length, "slip")}</span>
      <ul className="mt-2 text-xs text-on-night">
        {chain.broken.slice(0, 5).map((b) => (
          <li key={b.slipId}>
            <span className="font-mono">{b.slipId}</span> at <span className="font-mono">#{b.brokenAtSeq ?? "?"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function LedgerBody() {
  await connection();
  const rt = getRuntime();
  const { ledger } = consoleFigures(rt);
  const lab = chainLab(rt, featuredRuns(rt).shop?.runId ?? null);
  const recent = rt.store.ledger.listRecent(20).length;
  const serverCheck = lab ? rt.store.ledger.verifyChain(lab.slipId) : { ok: true, brokenAtSeq: null };
  return (
    <>
      {lab ? (
        <ChainLab slipId={lab.slipId} events={lab.events} server={serverCheck} />
      ) : (
        <h2 id="recent-heading" className="max-w-[16ch] font-display text-section font-extrabold leading-[1.02] tracking-[-0.03em] text-on-night">
          Recent ledger events
        </h2>
      )}
      <div className="mt-8 border-t border-night-line pt-6">
        <ChainBadge chain={ledger} />
      </div>
      <details className="group mt-6 border-y border-night-line">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-3 text-base font-semibold text-on-night transition-colors duration-[120ms] hover:text-pp-sky">
          <span>Every recent event ({recent})</span>
          <span aria-hidden="true" className="text-sm font-normal text-on-night-soft group-open:hidden">Show</span>
          <span aria-hidden="true" className="hidden text-sm font-normal text-on-night-soft group-open:inline">Hide</span>
        </summary>
        <div className="pb-6 pt-2">
          <RecentEvents />
        </div>
      </details>
    </>
  );
}

async function RecentEvents() {
  await connection();
  const events = getRuntime().store.ledger.listRecent(20);
  if (events.length === 0) {
    return <p className="text-base text-on-night-soft">Nothing has happened yet. Start any pipeline above.</p>;
  }
  const groups: { slipId: string; events: typeof events }[] = [];
  for (const e of events) {
    const g = groups.find((x) => x.slipId === e.slipId);
    if (g) g.events.push(e);
    else groups.push({ slipId: e.slipId, events: [e] });
  }
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.slipId} aria-label={`Events on ${g.slipId}`}>
          <p className="mb-2 text-sm font-semibold text-on-night">
            Slip <span className="font-mono font-normal text-on-night-soft">{g.slipId}</span>
          </p>
          <ol className="divide-y divide-night-line border-y border-night-line">
            {g.events.map((e) => {
              const { title, detail } = describeEvent(e);
              return (
                <li key={`${e.slipId}-${e.seq}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 py-3.5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <ActorIcon actor={e.actor} />
                  <div className="min-w-0">
                    <p className="text-base text-on-night">{title}</p>
                    {detail ? <p className="text-sm text-on-night-soft">{detail}</p> : null}
                  </div>
                  <p className="col-start-2 flex flex-wrap gap-x-3 font-mono text-xs text-on-night-soft md:col-start-3 md:flex-col md:items-end md:gap-1">
                    <span>#{e.seq}</span>
                    <time dateTime={e.at}>{shortTime(e.at)}</time>
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function LedgerSection() {
  return (
    <section id="ledger" aria-labelledby="recent-heading" className="container-page mt-32">
      <div className="on-night rounded-plate bg-night px-6 py-12 text-on-night sm:px-10 lg:px-14 lg:py-16">
        <LedgerBody />
      </div>
    </section>
  );
}
