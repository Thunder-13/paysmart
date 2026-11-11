import { connection } from "next/server";
import { GuardLabClient } from "@/components/guard-lab";
import { resolveConfig } from "@/server/config";
import { featuredRuns } from "@/server/featured-runs";
import { guardLab } from "@/server/guard-lab";
import { getRuntime } from "@/server/runtime";

export async function GuardLabSection() {
  await connection();
  const config = resolveConfig();
  const rt = getRuntime();
  const mock = config.paypalMode === "mock" && config.aiMode === "mock";
  const lab = guardLab(rt, featuredRuns(rt).shop?.runId ?? null);
  if (!lab && !mock) return null;
  return (
    <section id="guard-lab" aria-labelledby="guard-lab-heading" className="container-page mt-32 scroll-mt-24">
      <div className="max-w-[60ch]">
        <h2 id="guard-lab-heading" className="font-display text-section font-extrabold leading-[1.02] tracking-[-0.03em] text-ink">
          Try to talk past the guard.
        </h2>
        {lab ? (
          <p className="mt-5 text-lg text-ink-soft">
            This is the real guard function, running in your browser on the facts behind ledger #{lab.seq}. It calls no model, and the planted listing text never reaches it.
          </p>
        ) : (
          <p className="mt-5 text-lg text-ink-soft">Load the demo story to put a hijacked cart here.</p>
        )}
      </div>
      {lab ? (
        <div className="mt-10">
          <GuardLabClient lab={lab} />
        </div>
      ) : null}
    </section>
  );
}
