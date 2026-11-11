import { describe, expect, it } from "vitest";
import { DisputeDeskInputSchema, NOTES_MAX, ResumeSignalSchema } from "./types";

describe("schemas", () => {
  it("resume signal rejects empty notes for contest and accepts hold with empty notes", () => {
    const empty = ResumeSignalSchema.safeParse({ decision: "contest", notes: "   " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0].message).toMatch(/Write a response/);
    expect(ResumeSignalSchema.safeParse({ decision: "accept", notes: "" }).success).toBe(false);
    expect(ResumeSignalSchema.parse({ decision: "hold" })).toEqual({ decision: "hold", notes: "" });
    expect(ResumeSignalSchema.safeParse({ decision: "contest", notes: "x".repeat(NOTES_MAX + 1) }).success).toBe(false);
    expect(ResumeSignalSchema.safeParse({ decision: "escalate", notes: "x" }).success).toBe(false);
  });

  it("input rejects empty disputeId", () => {
    expect(DisputeDeskInputSchema.safeParse({ disputeId: "" }).success).toBe(false);
    expect(DisputeDeskInputSchema.safeParse({}).success).toBe(false);
    expect(DisputeDeskInputSchema.parse({ disputeId: " PP-D-1 " })).toEqual({ disputeId: "PP-D-1" });
  });
});
