"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, resumeRun, useRun } from "@/components/run-client";
import type { BoardData } from "@/pipelines/bounty/board";
import type { BountyState } from "@/pipelines/bounty/schema";
import { BountyCard } from "./bounty-card";
import { CreateForm } from "./create-form";
import { EmptyState } from "./empty-state";

const POLL_MS = 3000;

const OUTCOME: Record<string, { text: string; className: string }> = {
  held: { text: "PayPal is holding your pledge. Nothing is charged unless the proof passes.", className: "border-pp-gold bg-pp-gold-wash" },
  declined: { text: "You backed out at PayPal, so nothing is held.", className: "border-line bg-paper-deep" },
  voided_late: { text: "The bounty closed before you signed, so PayPal voided the hold right away.", className: "border-line bg-paper-deep" },
};

export function BountyBoard({ initial, focusBounty, returnRunId }: { initial: BoardData; focusBounty: string | null; returnRunId: string | null }) {
  const [data, setData] = useState(initial);
  const refresh = useCallback(async () => {
    try {
      setData(await fetchJson<BoardData>("/api/p/bounty"));
    } catch {
      // Keep the last board; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Back from PayPal: once the pledge run finishes, nudge the bounty run so it recounts funding.
  const { run: returned } = useRun(returnRunId);
  const nudged = useRef(false);
  const pledgeState = returned?.pipeline === "bounty" ? (returned.state as BountyState) : null;
  const pledgeDone = pledgeState?.kind === "pledge" && (returned?.status === "done" || returned?.status === "failed");
  useEffect(() => {
    if (!pledgeDone || nudged.current || !pledgeState?.bountyId) return;
    const entry = data.bounties.find((b) => b.bounty.id === pledgeState.bountyId);
    if (!entry?.run || entry.run.status !== "waiting") return;
    nudged.current = true;
    void resumeRun(entry.run.id, { event: "pledge" })
      .catch(() => undefined)
      .then(refresh);
  }, [pledgeDone, pledgeState, data, refresh]);

  const outcome = pledgeState?.kind === "pledge" && pledgeState.outcome ? OUTCOME[pledgeState.outcome] : null;

  return (
    <div className="space-y-6">
      {outcome ? (
        <p role="status" className={`rounded-card border-2 px-5 py-4 text-base text-ink ${outcome.className}`}>
          {outcome.text}
        </p>
      ) : null}
      {returned?.status === "failed" && pledgeState?.kind === "pledge" ? (
        <p role="alert" className="rounded-card border-2 border-stamp-red bg-red-wash px-5 py-4 text-base text-ink">
          {returned.error}
        </p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-label="Bounties" className={`space-y-5 ${data.bounties.length === 0 ? "lg:self-stretch" : ""}`}>
          {data.bounties.length === 0 ? (
            <EmptyState />
          ) : (
            data.bounties.map((entry) => (
              <BountyCard key={entry.bounty.id} entry={entry} highlight={entry.bounty.id === focusBounty} onChanged={() => void refresh()} />
            ))
          )}
        </section>
        <aside className="lg:sticky lg:top-[calc(var(--nav-height)+1rem)]">
          <CreateForm onCreated={() => void refresh()} />
        </aside>
      </div>
    </div>
  );
}

export default BountyBoard;
