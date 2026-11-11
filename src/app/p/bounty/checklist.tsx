import type { Verdict } from "@/core/contracts";
import { VerdictStamp } from "@/components/verdict-stamp";
import { shortTime } from "@/components/slip-figures";
import type { CheckResult, ProofAttempt } from "@/pipelines/bounty/schema";

const MARK: Record<CheckResult["status"], { text: string; className: string; disc: string; icon: string }> = {
  pass: { text: "passed", className: "text-pp-deep", disc: "bg-pp-sky text-night", icon: "M4 10l4 4 8-9" },
  fail: { text: "failed", className: "text-stamp-red", disc: "bg-stamp-red text-on-plate", icon: "M5 5l10 10M15 5L5 15" },
  skipped: { text: "not checked", className: "text-ink-faint", disc: "bg-card text-ink-faint", icon: "M5 10h10" },
};

/** Result of one proof attempt: a stamp plus one row per check with its reason. */
export function Checklist({ attempt, number }: { attempt: ProofAttempt; number: number }) {
  const verdict: Verdict = {
    decision: attempt.pass ? "within" : "outside",
    violations: [],
    unknowns: [],
    checkedAt: attempt.at,
  };
  const failed = attempt.results.filter((r) => r.status === "fail").length;
  return (
    <div className="space-y-3">
      <VerdictStamp
        verdict={verdict}
        label={attempt.pass ? "VERIFIED" : "REJECTED"}
        caption={attempt.pass ? `Attempt ${number}: every check passed.` : `Attempt ${number}: ${failed} check${failed === 1 ? "" : "s"} failed. Pledges stay held.`}
      />
      <div aria-live="polite">
        <ul className="rounded-md bg-paper-deep px-4 py-1" aria-label={`Checks for attempt ${number}, ${shortTime(attempt.at)}`}>
          {attempt.results.map((r) => {
            const m = MARK[r.status];
            return (
              <li key={r.id} className="relative flex gap-3 py-3 after:absolute after:-bottom-3 after:left-[calc(0.75rem-0.5px)] after:top-10 after:w-px after:bg-edge last:after:hidden">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill ${m.disc}`}>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d={m.icon} />
                  </svg>
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-ink">
                    {r.label} <span className={`text-xs font-semibold ${m.className}`}>({m.text})</span>
                  </p>
                  <p className="mt-0.5 text-ink-soft">{r.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default Checklist;
