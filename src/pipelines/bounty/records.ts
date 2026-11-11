/**
 * Read and write helpers over the store. Slips are the source of truth for money; the bounty
 * record holds only what slips can't (rubric, claim, attempts, receipt).
 */
import type { Actor, Collection, Money, Slip, SlipStatus, Store } from "@/core/contracts";
import { appendEvent } from "@/core/events";
import { sumMoney } from "@/core/money";
import { BOUNTY_COLLECTION, PROOF_COLLECTION, type Bounty, type ProofRow } from "./schema";

export function bounties(store: Store): Collection<Bounty> {
  return store.collection<Bounty>("bounty", BOUNTY_COLLECTION);
}

export function proofs(store: Store): Collection<ProofRow> {
  return store.collection<ProofRow>("bounty", PROOF_COLLECTION);
}

export function mustBounty(store: Store, id: string): Bounty {
  const b = bounties(store).get(id);
  if (!b) throw new Error(`No bounty ${id}`);
  return b;
}

export function saveBounty(store: Store, bounty: Bounty, patch: Partial<Bounty>, now: Date): Bounty {
  const next = { ...bounty, ...patch, updatedAt: now.toISOString() };
  bounties(store).put(next.id, next);
  return next;
}

/** Every pledge slip for a bounty, any status, in creation order. */
export function pledgeSlips(store: Store, bountyId: string): Slip[] {
  return store.slips
    .list({ pipeline: "bounty" })
    .filter((s) => s.meta.role === "pledge" && s.meta.bountyId === bountyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Pledges whose money is held or already moved. Unsigned pledges never count. */
const FUNDED_STATUSES: SlipStatus[] = ["active", "settling", "settled"];

export function fundedTotal(store: Store, bounty: Pick<Bounty, "id" | "reward">): Money {
  const held = pledgeSlips(store, bounty.id).filter((s) => FUNDED_STATUSES.includes(s.status));
  return sumMoney(
    held.map((s) => s.budget),
    bounty.reward.currency,
  );
}

export function signedAtOf(slip: Slip): string {
  return typeof slip.meta.signedAt === "string" ? slip.meta.signedAt : slip.createdAt;
}

/** Namespaced bounty event on the payout slip's chain. `message` is the plain-words line timelines show. */
export function bountyEvent(store: Store, payoutSlipId: string, type: `bounty.${string}`, actor: Actor, data: { message: string } & Record<string, unknown>): void {
  store.ledger.append(payoutSlipId, type, actor, data);
}

/** Status change outside CoreServices, with the same slip.status event core writes. */
export function setSlipStatus(store: Store, slip: Slip, to: SlipStatus, reason: string): Slip {
  if (slip.status === to) return slip;
  const updated = store.slips.update(slip.id, { status: to });
  appendEvent(store.ledger, slip.id, "slip.status", "system", { from: slip.status, to, reason });
  return updated;
}
