import { describe, expect, it } from "vitest";
import { BountyPipelineInputSchema, initialState, parseBountySignal } from "./schema";

const photo = { blobRef: "blob_1", capturedAt: "2026-11-10T12:00:00.000Z", dHash: "0123456789abcdef" };

describe("bounty schemas", () => {
  it("parses both input kinds", () => {
    const bounty = BountyPipelineInputSchema.parse({
      kind: "bounty",
      title: "Clear the drain",
      description: "Leaves on the grate in front of 41 Elm St.",
      reward: { currency: "USD", value: "40.00" },
      deadline: "2026-11-11T12:00:00.000Z",
      location: { lat: 40, lng: -75, radiusM: 150 },
      organizer: { name: "Priya", email: null },
    });
    expect(initialState(bounty)).toMatchObject({ kind: "bounty", bountyId: null, pledge: null });
    const pledge = BountyPipelineInputSchema.parse({
      kind: "pledge",
      bountyId: "bounty_1",
      backer: { name: "Ann", email: "ann@example.com" },
      amount: { currency: "USD", value: "25.00" },
    });
    expect(initialState(pledge)).toMatchObject({ kind: "pledge", bountyId: "bounty_1", bounty: null });
  });

  it("parses every bounty-run signal", () => {
    const signals = [
      { event: "pledge" },
      { event: "tick" },
      { event: "cancel" },
      { event: "claim", workerName: "Dana", workerEmail: "dana@example.com" },
      { event: "proof", before: photo, after: { ...photo, lat: 40.1, lng: -75.2 } },
      { event: "payout_retry" },
      { event: "payout_refund" },
    ];
    for (const s of signals) expect(parseBountySignal(s)).toMatchObject({ ok: true, signal: { event: s.event } });
  });

  it("maps WaitPanel confirm buttons onto the payout choice", () => {
    expect(parseBountySignal({ approved: true })).toEqual({ ok: true, signal: { event: "payout_retry" } });
    expect(parseBountySignal({ approved: false })).toEqual({ ok: true, signal: { event: "payout_refund" } });
  });

  it("refuses unknown events, malformed emails and malformed hashes with a reason", () => {
    expect(parseBountySignal({ event: "pay_me_now" })).toMatchObject({ ok: false });
    const email = parseBountySignal({ event: "claim", workerName: "Dana", workerEmail: "dana at example" });
    expect(email).toMatchObject({ ok: false });
    if (!email.ok) expect(email.reason).toMatch(/workerEmail/);
    const hash = parseBountySignal({ event: "proof", before: { ...photo, dHash: "xyz" }, after: photo });
    expect(hash).toMatchObject({ ok: false });
    if (!hash.ok) expect(hash.reason).toMatch(/before\.dHash/);
    expect(parseBountySignal(undefined)).toMatchObject({ ok: false });
  });
});
