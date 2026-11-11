import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@/core/contracts";
import { describeEvent } from "./event-text";

function event(type: string, data: unknown): LedgerEvent {
  return { slipId: "slip_1", seq: 1, at: "2026-11-11T10:00:00.000Z", type, actor: "system", data, prevHash: "0", hash: "1" } as unknown as LedgerEvent;
}

describe("describeEvent for PaySmart events", () => {
  it("uses data.message as the title for every paysmart.* event", () => {
    for (const type of ["paysmart.routed", "paysmart.request_screened", "paysmart.board", "paysmart.outcome", "paysmart.attested"]) {
      expect(describeEvent(event(type, { message: "Two searches ran, one per need" })).title).toBe("Two searches ran, one per need");
    }
  });

  it("falls back to the humanized type name when there is no message", () => {
    expect(describeEvent(event("paysmart.outcome", {})).title).toBe("paysmart outcome");
  });
});
