import Link from "next/link";
import { connection } from "next/server";
import { PAYSMART_EXAMPLES } from "@/pipelines/paysmart/types";
import { featuredRuns } from "@/server/featured-runs";
import { getRuntime } from "@/server/runtime";

const STEPS = [
  "Say what you need, in plain words.",
  "PaySmart runs one search per need and screens every result.",
  "An agent builds up to three carts. The guard checks each one.",
  "You pick one. PayPal holds that cart's total, then captures it.",
];

/**
 * The home hero: PaySmart's ask box, first in the first viewport. A plain GET form, so it works with
 * scripting off and lands on /p/paysmart?ask=. The signed-slip proof follows in hero.tsx.
 */
export async function PaySmartHero() {
  await connection();
  const run = featuredRuns(getRuntime()).paysmart;
  return (
    <section aria-labelledby="paysmart-heading" className="on-night rounded-b-plate bg-night text-on-night">
      <div className="container-page grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 pb-14 pt-8 sm:pt-10 lg:grid-cols-12 lg:items-center lg:pb-20 lg:pt-12">
        <div className="min-w-0 lg:col-span-7">
          <h1 id="paysmart-heading" className="font-display text-[clamp(3.25rem,7vw+0.5rem,7rem)] font-extrabold leading-[0.9] tracking-display text-on-night">
            PaySmart
          </h1>
          <p className="mt-4 max-w-[34ch] text-lead leading-snug text-on-night-soft">Say what you need. PayPal pays only for the cart you pick.</p>
          <form action="/p/paysmart" method="get" className="mt-8">
            <label htmlFor="paysmart-ask" className="block text-base font-semibold text-on-night">
              What do you need?
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="paysmart-ask"
                name="ask"
                type="text"
                required
                minLength={5}
                maxLength={600}
                autoComplete="off"
                placeholder="A dinosaur gift and a birthday card, under $60"
                className="field h-14 w-full min-w-0 shrink-0 px-5 text-base text-ink placeholder:text-ink-faint sm:w-auto sm:flex-1 sm:shrink"
              />
              <button
                type="submit"
                className="inline-flex h-14 shrink-0 items-center justify-center whitespace-nowrap rounded-pill bg-on-night px-8 text-base font-semibold text-night transition-colors duration-[120ms] hover:bg-pp-sky active:bg-pp-sky-wash focus-visible:outline-pp-sky"
              >
                Start with PaySmart
              </button>
            </div>
          </form>
          <div className="mt-6">
            <p className="text-sm text-on-night-soft">Or start from an example</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {PAYSMART_EXAMPLES.map((ex) => (
                <li key={ex.label}>
                  <Link
                    href={`/p/paysmart?ask=${encodeURIComponent(ex.ask)}`}
                    className="inline-flex h-11 items-center whitespace-nowrap rounded-pill border border-night-line bg-night-2 px-4 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-night-3 active:bg-night-line"
                  >
                    {ex.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <div className="rounded-2xl bg-night-2 p-6 sm:p-8">
            <h2 className="font-display text-xl font-extrabold tracking-tight text-on-night">How it works</h2>
            <ol className="mt-5 space-y-4">
              {STEPS.map((text, i) => (
                <li key={text} className="flex gap-3.5 text-base text-on-night">
                  <span className="mt-px inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-pp-sky text-sm font-semibold tabular-nums text-night">{i + 1}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-on-night-soft">Asks that are not shopping go to the pipeline built for them.</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
              {run ? (
                <Link
                  href={`/p/paysmart?run=${encodeURIComponent(run.runId)}`}
                  className="inline-flex min-h-11 items-center rounded-sm text-base font-semibold text-on-night underline decoration-night-line underline-offset-[6px] transition-colors duration-[120ms] hover:decoration-pp-sky"
                >
                  {run.label ? "Open the PaySmart demo run" : "Open the latest PaySmart run"}
                </Link>
              ) : null}
              <a
                href="#proof"
                className="inline-flex min-h-11 items-center rounded-sm text-base font-semibold text-on-night underline decoration-night-line underline-offset-[6px] transition-colors duration-[120ms] hover:decoration-pp-sky"
              >
                See the guard stop a hijack
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
