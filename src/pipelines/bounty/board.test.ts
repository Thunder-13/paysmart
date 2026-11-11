import { describe, expect, it } from "vitest";
import { buildBoard } from "./board";
import { makeKit } from "./testkit";

describe("board read model", () => {
  it("shows funding, pledges and the run's wait", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    await kit.pledge(bounty.id, "Ann Lee", "25.00");
    const board = buildBoard(kit.rt);
    expect(board.bounties).toHaveLength(1);
    const entry = board.bounties[0];
    expect(entry.funded.value).toBe("25.00");
    expect(entry.pledges).toHaveLength(1);
    expect(entry.payoutSlip?.id).toBe(bounty.payoutSlipId);
    expect(entry.run).toMatchObject({ status: "waiting", step: "funding", wait: { kind: "external_event" } });
    expect(JSON.parse(JSON.stringify(board))).toEqual(board);
  });
});
