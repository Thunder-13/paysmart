import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { resolveConfig } from "@/server/config";
import { readDemoStory } from "@/server/demo-restore";
import { featuredRuns } from "@/server/featured-runs";
import { HeroReplay } from "@/components/hero-replay";
import { ClearanceBoard, BAYS } from "@/components/clearance-board";
import { heroBoard, type HeroBoard } from "@/server/hero-board";
import { getRuntime } from "@/server/runtime";
import { DemoStoryButton } from "../demo-story-button";
import { plural } from "./shared";

/* ----------------------------------------------------------------- hero */

function HeroBoardView({ board, mock }: { board: HeroBoard | null; mock: boolean }) {
  if (!board) {
    return (
      <figure aria-label="Clearance board, empty" className="rounded-2xl bg-night-2 p-6">
        <ul className="relative space-y-5">
          {BAYS.map((b) => (
            <li key={b.decision} className="rack pb-5 last:bg-none">
              <p className="text-sm font-semibold text-on-night">{b.name}</p>
              <div className="mt-3 flex h-14 overflow-hidden rounded-md border border-night-line bg-night" aria-hidden="true">
                <span className={`w-2.5 shrink-0 ${b.holder.split(" ")[0]}`} />
              </div>
            </li>
          ))}
          <li aria-hidden="true" className="replay-idle pointer-events-none absolute inset-0 overflow-hidden">
            <span className="replay-idle-bar absolute inset-y-0 left-0 block w-full">
              <span className="absolute inset-y-0 left-1/2 block w-1 bg-pp-sky" />
            </span>
          </li>
        </ul>
        <figcaption className="mt-5 text-sm text-on-night-soft">
          {mock
            ? "Load the demo story and seven finished runs land here, starting with a hijacked cart the guard refuses."
            : "No verdicts yet. Every cart, pledge and fetch the guard checks racks up here."}
        </figcaption>
      </figure>
    );
  }
  return (
    <HeroReplay
      caption={
        <>
          {`The guard’s calls on this slip, read from its ledger. ${
            board.chain.ok ? `Chain verified across ${plural(board.events, "event")}.` : `Chain broken at #${board.chain.brokenAtSeq ?? "?"}.`
          }`}
          {board.lastHash ? (
            <>
              {" Last hash "}
              <span className="font-mono text-on-night" title={board.lastHash}>
                {board.lastHash.slice(0, 12)}
              </span>
            </>
          ) : null}
        </>
      }
    >
      <ClearanceBoard slip={board.slip} strips={board.strips} />
    </HeroReplay>
  );
}

export async function Hero() {
  await connection();
  const config = resolveConfig();
  const rt = getRuntime();
  const mock = config.paypalMode === "mock" && config.aiMode === "mock";
  const doc = mock ? readDemoStory(rt.store) : null;
  const shopRun = featuredRuns(rt).shop;
  const board = heroBoard(rt, shopRun?.runId ?? null);
  return (
    <ProofFrame board={board} mock={mock}>
      {mock ? (
        <DemoStoryButton loaded={doc?.status === "loaded"} tone="night" />
      ) : (
        <Link
          href={shopRun ? `/p/shop?run=${encodeURIComponent(shopRun.runId)}` : "/p/shop"}
          className="inline-flex h-12 items-center whitespace-nowrap rounded-pill bg-on-night px-7 text-base font-semibold text-night transition-colors duration-[120ms] hover:bg-pp-sky active:bg-pp-sky-wash"
        >
          {shopRun ? "Open the Shop run" : "Write a slip"}
        </Link>
      )}
    </ProofFrame>
  );
}

export function ProofFrame({ board, mock = false, children }: { board: HeroBoard | null; mock?: boolean; children?: ReactNode }) {
  return (
    <section id="proof" aria-labelledby="proof-heading" className="container-page mt-20 scroll-mt-24 lg:mt-28">
      <div className="on-night grid grid-cols-[minmax(0,1fr)] items-center gap-x-6 gap-y-12 rounded-plate bg-night px-6 py-12 text-on-night sm:px-10 lg:grid-cols-12 lg:px-14 lg:py-16">
        <div className="min-w-0 lg:col-span-5">
          <h2 id="proof-heading" className="max-w-[12ch] font-display text-[clamp(2.25rem,3.6vw+0.75rem,4.25rem)] font-extrabold leading-[0.98] tracking-display text-on-night">
            Watch the guard stop a hijacked cart.
          </h2>
          <p className="mt-6 max-w-[40ch] text-lead leading-snug text-on-night-soft">
            Every dollar an AI touches carries a signed Permission Slip. You write the rules, PayPal holds the money, and the guard checks every move.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            {children}
            <a
              href="#ledger"
              className="rounded-sm text-base font-semibold text-on-night underline decoration-night-line underline-offset-[6px] transition-colors duration-[120ms] hover:decoration-pp-sky"
            >
              Read the ledger
            </a>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <HeroBoardView board={board} mock={mock} />
        </div>
      </div>
    </section>
  );
}
