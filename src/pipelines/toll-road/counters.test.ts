import { describe, expect, it } from "vitest";
import { reduceTollEvents } from "./counters";
import { clockedRuntime, runThrough } from "./test-helpers";

describe("live counters", () => {
  it("mock event sequence ends at 4 paid, 2 refused, $0.13 spent, $0.02 remaining", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    const c = reduceTollEvents(rt.store.ledger.list(run.slipId!));
    expect(c.paid).toBe(4);
    expect(c.refused).toBe(2);
    expect(c.spent?.value).toBe("0.13");
    expect(c.remaining?.value).toBe("0.02");
    expect(c.captured?.value).toBe("0.13");
    expect(Object.fromEntries(c.byPublisher.map((p) => [p.publisherId, p.total.value]))).toEqual({
      "long-ridge": "0.05",
      "quarry-street": "0.04",
      tidewater: "0.04",
    });
    const fetchStamps = c.stamps.filter((s) => s.kind === "paid" || s.kind === "refused");
    expect(fetchStamps.map((s) => s.title)).toEqual([
      "Paid $0.02",
      "Paid $0.04",
      "402 Price above cap",
      "Paid $0.05",
      "Paid $0.02",
      "402 Budget exhausted",
    ]);
    expect(fetchStamps.find((s) => s.contentId === "tw-2")?.injection).toBe(true);
    expect(c.stamps.some((s) => s.kind === "agent")).toBe(true);
    expect(c.stamps.at(-1)?.title).toBe("Publishers paid");
  });

  it("partial streams count what has arrived so far", async () => {
    const { rt } = clockedRuntime();
    const run = await runThrough(rt);
    const events = rt.store.ledger.list(run.slipId!);
    const firstMeter = events.findIndex((e) => e.type === "toll-road.metered");
    const c = reduceTollEvents(events.slice(0, firstMeter + 1));
    expect(c.paid).toBe(1);
    expect(c.spent?.value).toBe("0.02");
    expect(c.remaining?.value).toBe("0.13");
  });
});
