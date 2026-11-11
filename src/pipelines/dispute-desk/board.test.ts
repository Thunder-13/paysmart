import { describe, expect, it } from "vitest";
import type { RailDispute } from "@/core/contracts";
import { money } from "@/core/money";
import { buildBoard, defaultSelection, laneOf, LANES, urgencyOf } from "./board";

const NOW = new Date("2026-11-10T12:00:00.000Z");

function d(id: string, status: string, due: string | null, createdAt = "2026-11-01T00:00:00.000Z"): RailDispute {
  return { id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status, amount: money("10.00"), createdAt, sellerResponseDueAt: due, transactionId: null, buyerEmail: null, messages: [] };
}

describe("board", () => {
  it("urgency thresholds", () => {
    const dues = ["2026-11-10T11:00:00Z", "2026-11-12T00:00:00Z", "2026-11-15T12:00:00Z", "2026-11-20T12:00:00Z", null];
    expect(dues.map((x) => urgencyOf(x, NOW).urgency)).toEqual(["overdue", "urgent", "soon", "ok", "none"]);
    expect(urgencyOf("2026-11-12T00:00:00Z", NOW).hoursLeft).toBe(36);
    expect(urgencyOf("2026-11-12T12:00:00Z", NOW).urgency).toBe("urgent");
    expect(urgencyOf("not a date", NOW).urgency).toBe("none");
  });

  it("APPEALABLE lands in Other", () => {
    expect(laneOf("APPEALABLE")).toBe("other");
    expect(laneOf("WAITING_FOR_SELLER_RESPONSE")).toBe("needs_response");
    expect(laneOf("UNDER_REVIEW")).toBe("with_paypal");
    expect(LANES.map((l) => l.title)).toEqual(["Needs your response", "Open", "Waiting on buyer", "With PayPal", "Resolved", "Other"]);
  });

  it("cards sort by due date with undated last", () => {
    const board = buildBoard({
      disputes: [
        d("late", "WAITING_FOR_SELLER_RESPONSE", "2026-11-19T00:00:00Z"),
        d("none", "WAITING_FOR_SELLER_RESPONSE", null),
        d("soon", "WAITING_FOR_SELLER_RESPONSE", "2026-11-11T00:00:00Z"),
        d("done", "RESOLVED", "2026-11-01T00:00:00Z"),
        d("odd", "APPEALABLE", null),
      ],
      now: NOW,
      mode: "mock",
      linkOf: () => ({ method: "none", slipId: null }),
      caseOf: () => null,
    });
    expect(board.lanes[0].cards.map((c) => c.disputeId)).toEqual(["soon", "late", "none"]);
    expect(board.lanes[0].cards[0]).toMatchObject({ urgency: "urgent", reasonLabel: "Item not received" });
    const resolved = board.lanes.find((l) => l.id === "resolved")!.cards[0];
    expect(resolved).toMatchObject({ disputeId: "done", urgency: "none" });
    expect(board.lanes.find((l) => l.id === "other")!.cards.map((c) => c.disputeId)).toEqual(["odd"]);
    expect(board.total).toBe(5);
  });

  describe("default selection", () => {
    const board = (disputes: RailDispute[], linked: string[]) =>
      buildBoard({
        disputes,
        now: NOW,
        mode: "mock",
        linkOf: (x) => (linked.includes(x.id) ? { method: "capture", slipId: `slip_${x.id}` } : { method: "none", slipId: null }),
        caseOf: () => null,
      });
    const disputes = [
      d("unlinked-soonest", "WAITING_FOR_SELLER_RESPONSE", "2026-11-10T18:00:00Z"),
      d("linked-later", "WAITING_FOR_SELLER_RESPONSE", "2026-11-14T00:00:00Z"),
      d("linked-sooner", "WAITING_FOR_SELLER_RESPONSE", "2026-11-12T00:00:00Z"),
      d("linked-review", "UNDER_REVIEW", null),
    ];

    it("prefers the most urgent linked dispute that needs a response", () => {
      expect(defaultSelection(board(disputes, ["linked-later", "linked-sooner", "linked-review"]))).toBe("linked-sooner");
    });

    it("then any linked dispute, then the first card in the most pressing lane", () => {
      expect(defaultSelection(board(disputes, ["linked-review"]))).toBe("linked-review");
      expect(defaultSelection(board(disputes, []))).toBe("unlinked-soonest");
      expect(defaultSelection(board([d("only", "RESOLVED", null)], []))).toBe("only");
      expect(defaultSelection(board([], []))).toBeNull();
    });
  });
});
