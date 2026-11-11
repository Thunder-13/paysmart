import { describe, expect, it } from "vitest";
import { normalizeCompiledSlip } from "@/core/services";
import { mockCompile } from "./compile";
import { cleanBreaches, deliveryEvidenceDetail, deliveryPrompt, mockDeliveryCheck, refundDecision } from "./delivery";
import { CLEAN_PICK_ID, fixtureById, fixtureFacts, toListing } from "./fixtures";
import { DEMO_INTENT } from "./types";

const NOW = new Date("2026-11-08T18:00:00.000Z");
const clauses = normalizeCompiledSlip(mockCompile(DEMO_INTENT, NOW), NOW).clauses;
const rex = fixtureById(CLEAN_PICK_ID)!;

describe("delivery check", () => {
  it("prompts with clauses and facts and leaves the listing description out", () => {
    const prompt = deliveryPrompt(clauses, [{ title: rex.title, quantity: 1, facts: fixtureFacts(rex, NOW) }]);
    expect(prompt).toContain("Nothing that needs batteries");
    expect(prompt).toContain('"power_source": "wind_up"');
    expect(prompt).not.toContain(toListing(rex, NOW).description);
    expect(prompt).not.toMatch(/walks and nods/);
  });

  it("finds the c5 breach in the sample photo and refunds on high confidence", () => {
    const check = mockDeliveryCheck(true, clauses);
    expect(check.breaches.map((b) => b.clauseId)).toEqual(["c5"]);
    expect(refundDecision(check)).toBe("refund");
    expect(refundDecision({ ...check, confidence: "low" })).toBe("ask");
    expect(refundDecision(mockDeliveryCheck(false, clauses))).toBe("none");
  });

  it("names every breached clause id in the evidence detail", () => {
    const detail = deliveryEvidenceDetail({
      breaches: [
        { clauseId: "c5", observation: "Battery pack in the box." },
        { clauseId: "c2", observation: "Two toys." },
      ],
      confidence: "high",
      summary: "Wrong box.",
    });
    expect(detail).toMatch(/^Delivery photo breaks c5, c2 \(c5: Battery pack in the box; c2: Two toys; confidence high\)\. Wrong box\.$/);
    expect(deliveryEvidenceDetail(mockDeliveryCheck(false, clauses))).toMatch(/^Delivery matches the slip/);
  });

  it("drops breaches that cite clauses the slip doesn't have", () => {
    const check = cleanBreaches({ breaches: [{ clauseId: "c99", observation: "x" }], confidence: "high", summary: "" }, clauses);
    expect(check.breaches).toHaveLength(0);
  });
});
