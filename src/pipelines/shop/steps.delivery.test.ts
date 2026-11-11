import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { SAMPLE_PHOTO_BASE64 } from "./sample-photo";
import { addDemoAffiliate, events, runToCart, shopRuntime, state } from "./test-utils";

async function settled(rt: ReturnType<typeof shopRuntime>) {
  const run = await runToCart(rt, { redTeam: true });
  return rt.orchestrator.resume(run.id, { approved: true });
}

describe("delivery check and refund", () => {
  it("reverses the affiliate estimate after the refund, and only then", async () => {
    const rt = shopRuntime();
    addDemoAffiliate(rt);
    let run = await settled(rt);
    expect(events(rt, run.slipId, "affiliate.reversed")).toHaveLength(0);
    run = await rt.orchestrator.resume(run.id, { sample: true });
    const all = events(rt, run.slipId);
    const rev = all.filter((e) => e.type === "affiliate.reversed");
    expect(rev).toHaveLength(1);
    expect(rev[0].actor).toBe("system");
    expect(rev[0].data).toMatchObject({ estCommission: money("1.68") });
    expect(rev[0].seq).toBeGreaterThan(all.find((e) => e.type === "rail.refunded")!.seq);
    expect(state(run).affiliate).toMatchObject({ reversed: true, estCommission: money("1.68") });
  });

  it("records no affiliate events when no account matched", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(events(rt, run.slipId).filter((e) => e.type.startsWith("affiliate."))).toHaveLength(0);
  });

  it("refunds $42.18 on the c5 breach in the sample photo and attaches an evidence pack", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(run.status).toBe("done");
    const s = state(run);
    expect(s.outcome).toBe("refunded");
    expect(s.delivery?.check.breaches.map((b) => b.clauseId)).toEqual(["c5"]);
    const refund = rt.mockRail.calls().find((c) => c.method === "refundCapture")!;
    expect(refund.args[1]).toMatchObject({ amount: money("42.18") });
    expect(rt.store.slips.get(run.slipId!)?.status).toBe("refunded");
    expect(s.evidencePack?.chain.ok).toBe(true);
    expect(s.evidencePack?.evidence.some((e) => e.kind === "delivery_photo" && e.verdict === "fail")).toBe(true);
    expect(s.totals?.refunded).toEqual(money("42.18"));
  });

  it("records delivery_photo evidence naming the breached clause before the refund", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    run = await rt.orchestrator.resume(run.id, { sample: true });
    const all = events(rt, run.slipId);
    const evidence = all.find((e) => e.type === "evidence.added");
    const refund = all.find((e) => e.type === "rail.refunded");
    expect(evidence && refund && evidence.seq < refund.seq).toBe(true);
    const ev = evidence!.data as { kind: string; verdict: string; detail: string; ref: string | null };
    expect(ev).toMatchObject({ kind: "delivery_photo", verdict: "fail" });
    expect(ev.detail).toMatch(/breaks c5\b/);
    expect(ev.ref).toBe(state(run).delivery?.photoRef);
  });

  it("finishes settled when the photo matches", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    const ref = rt.store.blobs.put({ contentType: "image/png", base64: SAMPLE_PHOTO_BASE64 });
    run = await rt.orchestrator.resume(run.id, { ref, contentType: "image/png" });
    expect(run.status).toBe("done");
    expect(state(run).outcome).toBe("settled");
    expect(rt.mockRail.calls().some((c) => c.method === "refundCapture")).toBe(false);
    const ev = events(rt, run.slipId, "evidence.added")[0].data as { kind: string; verdict: string; ref: string };
    expect(ev).toMatchObject({ kind: "delivery_photo", verdict: "pass", ref });
  });

  it("re-asks for a file that isn't a photo", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    const ref = rt.store.blobs.put({ contentType: "application/json", base64: "e30=" });
    run = await rt.orchestrator.resume(run.id, { ref });
    expect(run.step).toBe("verify_delivery");
    expect(String(run.wait?.message)).toMatch(/isn't a photo/);
  });

  it("asks before refunding on a low-confidence breach", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    const json = rt.ai.json.bind(rt.ai);
    vi.spyOn(rt.ai, "json").mockImplementation(async (req) => {
      const out = await json(req);
      return req.label === "shop.delivery_check" ? ({ ...(out as object), confidence: "low" } as typeof out) : out;
    });
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(run.step).toBe("confirm_refund");
    run = await rt.orchestrator.resume(run.id, { approved: false });
    expect(state(run).outcome).toBe("settled");
    expect(rt.mockRail.calls().some((c) => c.method === "refundCapture")).toBe(false);
  });

  it("fails the run with the PayPal error when the refund fails", async () => {
    const rt = shopRuntime();
    let run = await settled(rt);
    vi.spyOn(rt.rail, "refundCapture").mockRejectedValue(new Error("CAPTURE_FULLY_REFUNDED"));
    run = await rt.orchestrator.resume(run.id, { sample: true });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/CAPTURE_FULLY_REFUNDED/);
    expect(events(rt, run.slipId, "shop.refund_failed")).toHaveLength(1);
  });
});
