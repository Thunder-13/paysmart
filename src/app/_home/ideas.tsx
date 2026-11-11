import Link from "next/link";
import type { PipelineId } from "@/core/contracts";
import { PLATE_SKINS } from "@/components/plate-skins";
import { describePipeline } from "./pipelines";

/** The nine ideas from docs/IDEAS.md and the pipeline each one runs in. */
const IDEAS: {
  n: number;
  name: string;
  line: string;
  pipeline: PipelineId;
  how: string;
}[] = [
  {
    n: 1,
    name: "Permission Slip",
    line: "Plain-words mandate, PayPal hold, injection-proof guard, refund on breach",
    pipeline: "shop",
    how: "the core of Shop",
  },
  {
    n: 2,
    name: "Second Look",
    line: "Scam tactics read from the chat, then a protected goods payment",
    pipeline: "second-look",
    how: "its own pipeline",
  },
  {
    n: 3,
    name: "Bounty Board",
    line: "Backer holds, photo-checked proof, Payouts to the worker",
    pipeline: "bounty",
    how: "its own pipeline",
  },
  {
    n: 4,
    name: "Talk to Pay",
    line: "Dictate the slip, hear the verdicts, approve the cart by voice",
    pipeline: "shop",
    how: "voice add-on in Shop",
  },
  {
    n: 5,
    name: "Upstream",
    line: "Pay the open-source maintainers your code depends on",
    pipeline: "cash-weather",
    how: "second half of Cash Weather",
  },
  {
    n: 6,
    name: "Hire Wire",
    line: "Agents hire helper agents under child slips, paid by Payouts",
    pipeline: "shop",
    how: "helper slips in Shop",
  },
  {
    n: 7,
    name: "Toll Road",
    line: "HTTP 402 metered reading for AI agents, settled on PayPal",
    pipeline: "toll-road",
    how: "its own pipeline",
  },
  {
    n: 8,
    name: "Dispute Desk",
    line: "Dispute answers built from hash-chained slip evidence",
    pipeline: "dispute-desk",
    how: "its own pipeline",
  },
  {
    n: 9,
    name: "Cash Weather",
    line: "A 90-day forecast from PayPal history, tone-matched invoice nudges",
    pipeline: "cash-weather",
    how: "first half of Cash Weather",
  },
];

export /* ------------------------------------------------------------ the rest */

function IdeasMap() {
  return (
    <section aria-labelledby="ideas-heading" className="container-page mt-32">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="ideas-heading" className="max-w-[14ch] font-display text-section font-extrabold leading-[1.02] tracking-[-0.03em] text-ink">
            Nine ideas, seven pipelines
          </h2>
          <p className="mt-5 max-w-[38ch] text-base text-ink-soft">
            Some ideas share a pipeline because they share a slip. The file-by-file map with the tests behind each row is in{" "}
            <span className="font-mono text-sm">docs/IDEAS.md</span>.
          </p>
        </div>
        <div className="min-w-0 overflow-x-auto lg:col-span-8">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink text-sm text-ink-soft">
                <th scope="col" className="w-12 whitespace-nowrap py-3 pr-4 font-semibold">
                  #
                </th>
                <th scope="col" className="whitespace-nowrap py-3 pr-6 font-semibold">
                  Idea
                </th>
                <th scope="col" className="hidden whitespace-nowrap py-3 pr-6 font-semibold md:table-cell">
                  What it does
                </th>
                <th scope="col" className="whitespace-nowrap py-3 font-semibold">
                  Runs in
                </th>
              </tr>
            </thead>
            <tbody>
              {IDEAS.map((idea) => (
                <tr key={idea.n} className="border-b border-line align-baseline transition-colors duration-[120ms] hover:bg-paper-deep">
                  <td className="py-4 pr-4 text-base font-semibold tabular-nums text-ink-faint">{idea.n}</td>
                  <th scope="row" className="py-4 pr-6 text-lg font-semibold text-ink">
                    {idea.name}
                    <span className="mt-1 block text-sm font-normal text-ink-soft md:hidden">{idea.line}</span>
                  </th>
                  <td className="hidden py-4 pr-6 text-base text-ink-soft md:table-cell">{idea.line}</td>
                  <td className="py-4 text-base md:whitespace-nowrap">
                    <span className={`mr-2 inline-block rounded-pill px-2.5 py-0.5 align-middle text-sm font-semibold ${PLATE_SKINS[idea.pipeline].skin}`}>
                      {describePipeline(idea.pipeline).title}
                    </span>
                    <Link
                      href={`/p/${idea.pipeline}`}
                      className="rounded-sm text-ink underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue md:whitespace-nowrap"
                    >
                      {idea.how}
                      <span className="sr-only"> ({describePipeline(idea.pipeline).title})</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
