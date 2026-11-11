import { describe, expect, it } from "vitest";
import { chainStamp, decisionWords, noteState, outcomeAnnouncement, statusLabel, urgencyChip } from "./view";

describe("view helpers", () => {
  it("note state disables send for empty and 2001-character notes", () => {
    expect(noteState("")).toMatchObject({ canSend: false, empty: true, label: "0 / 2000: write a response first" });
    expect(noteState("x".repeat(2001))).toMatchObject({ canSend: false, over: true, label: "2001 / 2000: too long by 1" });
    expect(noteState("x".repeat(2000))).toMatchObject({ canSend: true, label: "2000 / 2000" });
    expect(noteState("", "hold").canSend).toBe(true);
  });

  it("chain stamp reads Chain verified with the count or Chain broken at #N", () => {
    expect(chainStamp({ ok: true, brokenAtSeq: null, eventCount: 14 })).toEqual({ text: "Chain verified, 14 events", tone: "green" });
    expect(chainStamp({ ok: false, brokenAtSeq: 4, eventCount: 14 })).toEqual({ text: "Chain broken at #4", tone: "red" });
    expect(chainStamp(null).text).toBe("No slip linked");
  });

  it("outcome announcement names the PayPal status and ledger seq", () => {
    expect(outcomeAnnouncement({ kind: "evidence_sent", decision: "contest", paypalStatus: "UNDER_REVIEW", ledgerSeq: 15, message: "" })).toBe(
      "Evidence sent to PayPal. Dispute status UNDER_REVIEW. Recorded on the ledger as #15.",
    );
    expect(outcomeAnnouncement({ kind: "held", decision: "hold", paypalStatus: null, ledgerSeq: null, message: "" })).toMatch(/Nothing was sent/);
  });

  it("urgency chips always carry text", () => {
    expect(urgencyChip("overdue", -3)).toMatchObject({ text: "Overdue 3 h", tone: "red", solid: true });
    expect(urgencyChip("urgent", 20)).toMatchObject({ text: "Due in 20 h", tone: "red" });
    expect(urgencyChip("soon", 100)).toMatchObject({ text: "Due in 4 d", tone: "amber" });
    expect(urgencyChip("ok", 216)).toMatchObject({ text: "Due in 9 d", tone: "green" });
    expect(urgencyChip("none", null)).toMatchObject({ text: "No deadline", tone: "muted" });
    expect(decisionWords("need_more").word).toBe("NEED MORE");
  });

  it("status labels read as plain words", () => {
    expect(statusLabel("WAITING_FOR_SELLER_RESPONSE")).toBe("Waiting for your response");
    expect(statusLabel("WAITING_FOR_BUYER_RESPONSE")).toBe("Waiting for the buyer");
    expect(statusLabel("UNDER_REVIEW")).toBe("Under review");
    expect(statusLabel("APPEALABLE")).toBe("Appealable");
    expect(statusLabel("SOME_NEW_STATE")).toBe("Some new state");
    expect(statusLabel("")).toBe("Unknown");
  });
});
