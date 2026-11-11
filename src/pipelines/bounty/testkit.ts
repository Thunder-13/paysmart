/**
 * Test helpers for the bounty pipeline: a runtime with a hand-driven clock, plus one-liners for
 * create, pledge (with mock PayPal approval), claim and proof. Imported by *.test.ts only.
 */
import type { Run } from "@/core/contracts";
import { money } from "@/core/money";
import { createTestRuntime } from "@/core/testing";
import definition from "./index";
import { FIXTURES, type FixtureName } from "./fixtures";
import { bounties } from "./records";
import type { Bounty, BountyState, CreateBountyInput, ProofPhoto } from "./schema";

export const START = "2026-11-10T12:00:00.000Z";
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export function makeKit(startIso = START) {
  let t = Date.parse(startIso);
  const rt = createTestRuntime({ now: () => new Date(t), pipelines: { bounty: definition }, seedRail: false });
  const clock = {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    iso(offsetMs = 0) {
      return new Date(t + offsetMs).toISOString();
    },
  };

  function bounty(id: string): Bounty {
    const b = bounties(rt.store).get(id);
    if (!b) throw new Error(`no bounty ${id}`);
    return b;
  }

  async function createBounty(over: Partial<CreateBountyInput> = {}): Promise<{ run: Run<BountyState>; bounty: Bounty }> {
    const input: CreateBountyInput = {
      kind: "bounty",
      title: "Clear the storm drain on Elm St",
      description: "Leaves are piled on the grate in front of 41 Elm St and the street floods when it rains.",
      reward: money("40.00"),
      deadline: clock.iso(48 * HOUR),
      location: null,
      organizer: { name: "Priya Shah", email: "priya@example.com" },
      ...over,
    };
    const run = (await rt.orchestrator.start("bounty", input)) as Run<BountyState>;
    const id = run.state.bountyId;
    return { run, bounty: id ? bounty(id) : (null as unknown as Bounty) };
  }

  /** Starts a pledge run and, unless told otherwise, approves it at mock PayPal and resumes it. */
  async function pledge(
    bountyId: string,
    name: string,
    amount: string,
    opts: { approve?: boolean; nudge?: boolean } = {},
  ): Promise<{ start: Run<BountyState>; run: Run<BountyState>; slipId: string | null }> {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const start = (await rt.orchestrator.start("bounty", {
      kind: "pledge",
      bountyId,
      backer: { name, email },
      amount: money(amount),
    })) as Run<BountyState>;
    if (start.status !== "waiting") return { start, run: start, slipId: start.state.pledgeSlipId };
    const orderId = (start.wait?.data as { orderId: string }).orderId;
    let run: Run<BountyState>;
    if (opts.approve === false) {
      rt.mockRail.cancelOrder(orderId);
      run = (await rt.orchestrator.resume(start.id, { approved: false, orderId })) as Run<BountyState>;
    } else {
      rt.mockRail.approveOrder(orderId, email);
      run = (await rt.orchestrator.resume(start.id, { approved: true, orderId })) as Run<BountyState>;
    }
    if (opts.nudge !== false) await nudge(bountyId, { event: "pledge" });
    return { start, run, slipId: run.state.pledgeSlipId };
  }

  /** Resume the bounty's run; returns null when the run is not waiting. */
  async function nudge(bountyId: string, signal: unknown): Promise<Run<BountyState> | null> {
    const b = bounty(bountyId);
    const run = rt.orchestrator.get(b.runId);
    if (!run || run.status !== "waiting") return null;
    return (await rt.orchestrator.resume(b.runId, signal)) as Run<BountyState>;
  }

  async function claim(bountyId: string, workerName = "Dana Ruiz", workerEmail = "dana@example.com") {
    return nudge(bountyId, { event: "claim", workerName, workerEmail });
  }

  function upload(name: FixtureName): string {
    const f = FIXTURES[name];
    return rt.store.blobs.put({ contentType: f.contentType, base64: f.base64 });
  }

  function photo(name: FixtureName, capturedAt: string, extra: Partial<ProofPhoto> = {}): ProofPhoto {
    return { blobRef: upload(name), capturedAt, dHash: FIXTURES[name].dHash, ...extra };
  }

  /** Proof with before at +5 min and after at +35 min from now, then advances the clock 40 min. */
  async function prove(bountyId: string, pair: [FixtureName, FixtureName], extra: { before?: Partial<ProofPhoto>; after?: Partial<ProofPhoto> } = {}) {
    const before = photo(pair[0], clock.iso(5 * MINUTE), extra.before);
    const after = photo(pair[1], clock.iso(35 * MINUTE), extra.after);
    clock.advance(40 * MINUTE);
    return nudge(bountyId, { event: "proof", before, after });
  }

  /** Create, 2 backers (25 + 15), claim. Leaves the run waiting for proof. */
  async function fundedAndClaimed() {
    const { bounty: b } = await createBounty();
    clock.advance(MINUTE);
    const p1 = await pledge(b.id, "Ann Lee", "25.00");
    clock.advance(MINUTE);
    const p2 = await pledge(b.id, "Bo Chen", "15.00");
    clock.advance(MINUTE);
    await claim(b.id);
    return { bountyId: b.id, pledgeIds: [p1.slipId as string, p2.slipId as string] };
  }

  return { rt, clock, bounty, createBounty, pledge, nudge, claim, upload, photo, prove, fundedAndClaimed };
}

export type Kit = ReturnType<typeof makeKit>;

export function railMethods(kit: Kit): string[] {
  return kit.rt.mockRail.calls().map((c) => c.method);
}
