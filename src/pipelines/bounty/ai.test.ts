import { describe, expect, it } from "vitest";
import { createMockAI } from "@/core/ai/mock";
import { DraftSchema, draftBounty, gradeResults, mockDraft, normalizeChecks, verifyProof } from "./ai";

const IMG = { mediaType: "image/png" as const, base64: "AA==" };

describe("bounty.draft", () => {
  it("drafts drain checks and shot instructions in mock mode", async () => {
    const d = await draftBounty(createMockAI(), { title: "Clear the storm drain on Elm St", description: "Leaves on the grate." });
    expect(d.checks.length).toBeGreaterThanOrEqual(2);
    expect(d.checks.length).toBeLessThanOrEqual(5);
    expect(d.checks.map((c) => c.id)).toContain("grate_clear");
    expect(d.shots.before).toMatch(/grate/);
    expect(d.shots.after.length).toBeGreaterThan(5);
  });

  it("falls back to generic checks for an unknown job", () => {
    const d = DraftSchema.parse(mockDraft("Paint the mailbox", "The post box at the corner is peeling."));
    expect(d.checks.map((c) => c.id)).toEqual(["job_done", "same_place", "nothing_left"]);
  });

  it("normalizes and de-duplicates check ids", () => {
    const out = normalizeChecks([
      { id: "Grate Clear!", label: "a" },
      { id: "grate_clear", label: "b" },
      { id: "***", label: "c" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["grate_clear", "grate_clear_2", "check_3"]);
  });
});

describe("bounty.verify grading", () => {
  const checks = [
    { id: "grate_clear", label: "Grate is clear" },
    { id: "same_spot", label: "Same drain" },
  ];

  it("counts a check the model left out as failed", () => {
    const g = gradeResults(checks, { checks: [{ id: "grate_clear", pass: true, reason: "Clear." }], notes: "" });
    expect(g.pass).toBe(false);
    expect(g.results[1]).toMatchObject({ id: "same_spot", status: "fail" });
    expect(g.results[1].detail).toMatch(/did not report/);
  });

  it("needs every drafted check to pass", () => {
    const fail = gradeResults(checks, {
      checks: [
        { id: "grate_clear", pass: false, reason: "Leaves still on the left side." },
        { id: "same_spot", pass: true, reason: "Same lamp post." },
      ],
      notes: "",
    });
    expect(fail.pass).toBe(false);
    const ok = gradeResults(checks, {
      checks: [
        { id: "GRATE_CLEAR", pass: true, reason: "Clear." },
        { id: "same_spot", pass: true, reason: "Same." },
      ],
      notes: "",
    });
    expect(ok.pass).toBe(true);
  });

  it("passes every check in mock mode", async () => {
    const v = await verifyProof(createMockAI(), { title: "Drain", rubric: "Clear grate.", checks, before: IMG, after: IMG });
    expect(v.pass).toBe(true);
    expect(v.results.every((r) => r.status === "pass")).toBe(true);
  });
});
