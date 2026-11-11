/**
 * Deadline sweep: resumes every waiting bounty run with {event: "tick"}. A run past its deadline
 * closes and voids its pledges; the rest just recount and keep waiting.
 */
import type { Orchestrator } from "@/core/contracts";
import type { BountyState } from "./schema";

export async function tickAll(rt: { orchestrator: Orchestrator }): Promise<{ resumed: number; closed: string[] }> {
  const waiting = rt.orchestrator
    .list({ pipeline: "bounty", status: "waiting" })
    .filter((r) => (r.state as BountyState).kind === "bounty" && r.wait?.kind !== "user_confirm");
  const closed: string[] = [];
  let resumed = 0;
  for (const run of waiting) {
    try {
      const after = await rt.orchestrator.resume(run.id, { event: "tick" });
      resumed += 1;
      if (after.status === "done") closed.push(run.id);
    } catch {
      // Another call resumed it first; the next tick sees its new state.
    }
  }
  return { resumed, closed };
}
