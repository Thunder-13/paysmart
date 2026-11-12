/**
 * The demo story record and the restore that runs when a mock-mode server boots.
 *
 * Slips, runs and the ledger live in SQLite, but the mock PayPal rail keeps disputes in memory. The
 * demo seed saves a snapshot of the disputes it created, and createServerRuntime puts back any that
 * the fresh mock rail does not have. Kept free of pipeline imports so runtime.ts can use it.
 */
import type { MockRailControls, PipelineId, RailDispute, Store } from "@/core/contracts";

export const DEMO_STORY_KEY = "story";

export interface DemoStoryRun {
  pipeline: PipelineId;
  runId: string;
  /** "main" runs get a row in the summary table; "support" runs feed them (pledges, a scam check). */
  role: "main" | "support";
  label: string;
}

export interface DemoStoryDoc {
  version: 1;
  status: "seeding" | "loaded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  runs: DemoStoryRun[];
  disputeIds: string[];
  /** Snapshot of the seeded disputes after the Dispute Desk run, for restoring the mock rail. */
  disputes: RailDispute[];
}

export function demoStories(store: Store) {
  return store.collection<DemoStoryDoc>("core", "demo-story");
}

export function readDemoStory(store: Store): DemoStoryDoc | null {
  return demoStories(store).get(DEMO_STORY_KEY);
}

/**
 * Re-seeds the saved demo disputes the mock rail is missing (by id; never touches one it already has). Returns how many it put back.
 * Synchronous on purpose: it runs inside createServerRuntime. Never throws.
 */
export function restoreDemoDisputes(
  store: Store,
  controls: (Pick<MockRailControls, "seedDisputes"> & { disputeIds?: () => string[] }) | null,
  present: string[] = [],
): number {
  if (!controls) return 0;
  try {
    const doc = readDemoStory(store);
    if (!doc || doc.disputes.length === 0) return 0;
    // A rail with shared state already holds the live disputes, and seeding the saved snapshot over
    // one would roll back its status and messages. Ask the rail which ids it has.
    const have = new Set([...present, ...(controls.disputeIds?.() ?? [])]);
    const missing = doc.disputes.filter((d) => !have.has(d.id));
    if (missing.length) controls.seedDisputes(missing);
    return missing.length;
  } catch {
    return 0;
  }
}
