import { describe, expect, it } from "vitest";
import { activityFromEvents, latestVerdict } from "./activity";
import { HIDDEN_INSTRUCTION } from "./fixtures";
import { runToCart, shopRuntime } from "./test-utils";

describe("activity stream", () => {
  it("maps a red-team run with a helper into cards", async () => {
    const rt = shopRuntime();
    let run = await runToCart(rt, { redTeam: true, hireHelper: true });
    run = await rt.orchestrator.resume(run.id, { approved: true });
    const cards = activityFromEvents(rt.store.ledger.list(run.slipId!));
    const kinds = cards.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["say", "search", "inspect", "verdict", "helper", "money"]));

    const search = cards.find((c) => c.kind === "search");
    expect(search?.kind === "search" && search.results[0].source).toBe("planted");

    const bundle = cards.find((c) => c.kind === "inspect" && c.listingId === "rt-dino-mega-bundle");
    expect(bundle?.kind === "inspect" && bundle.hidden).toEqual([HIDDEN_INSTRUCTION]);

    const stamps = cards.filter((c) => c.kind === "verdict");
    expect(stamps[0].kind === "verdict" && stamps[0].verdict.decision).toBe("outside");

    const helper = cards.find((c) => c.kind === "helper");
    expect(helper?.kind === "helper" && helper.stage).toBe("paid");
    expect(helper?.kind === "helper" && helper.message).toMatch(/Leo/);

    expect(latestVerdict(cards)?.verdict.decision).toBe("within");
  });
});
