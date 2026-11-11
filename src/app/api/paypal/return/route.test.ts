import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runToCartPrefix } from "../approve/test-support";
import type { ShopRuntime } from "@/pipelines/shop/test-utils";

const pending: Promise<unknown>[] = [];
const holder: { rt: ShopRuntime | null } = { rt: null };

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
  after: (fn: () => unknown) => {
    pending.push(Promise.resolve(fn()));
  },
}));
vi.mock("@/server/runtime", () => ({ getRuntime: () => holder.rt }));

import { GET as cancel } from "../cancel/route";
import { GET as ret } from "./route";

function get(path: string, slipId: string, orderId: string): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  url.searchParams.set("slipId", slipId);
  url.searchParams.set("token", orderId);
  const req = new Request(url) as unknown as NextRequest;
  Object.defineProperty(req, "nextUrl", { value: url });
  return req;
}

async function reachCart() {
  const ctx = await runToCartPrefix();
  holder.rt = ctx.rt;
  ctx.rt.mockRail.approveOrder(ctx.orderId, "buyer@example.com");
  const res = await ret(get("/api/paypal/return", ctx.run.slipId!, ctx.orderId));
  await Promise.all(pending);
  return { ...ctx, first: res };
}

const signed = (c: Awaited<ReturnType<typeof reachCart>>) => c.rt.store.ledger.list(c.run.slipId!).filter((e) => e.type === "slip.signed");

beforeEach(() => {
  pending.length = 0;
});

describe("GET /api/paypal/return", () => {
  it("resumes a run waiting at complete_signing and activates the slip", async () => {
    const c = await reachCart();
    expect(c.first.status).toBe(303);
    expect(c.first.headers.get("location")).toContain(`run=${c.run.id}`);
    expect(c.rt.store.slips.get(c.run.slipId!)!.status).toBe("active");
    expect(c.rt.orchestrator.get(c.run.id)?.step).toBe("confirm_cart");
  });

  it("a stale return link after the cart wait redirects without resuming", async () => {
    const c = await reachCart();
    const before = c.rt.mockRail.calls().length;
    const res = await ret(get("/api/paypal/return", c.run.slipId!, c.orderId));
    await Promise.all(pending);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`run=${c.run.id}`);
    const run = c.rt.orchestrator.get(c.run.id)!;
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("confirm_cart");
    expect(c.rt.mockRail.calls().slice(before).filter((x) => /capture/i.test(x.method))).toEqual([]);
    expect(signed(c)).toHaveLength(1);
  });
});

describe("GET /api/paypal/cancel", () => {
  it("a stale cancel link after the cart wait leaves the run, hold and slip alone", async () => {
    const c = await reachCart();
    const before = c.rt.mockRail.calls().length;
    const res = await cancel(get("/api/paypal/cancel", c.run.slipId!, c.orderId));
    await Promise.all(pending);
    expect(res.status).toBe(303);
    const run = c.rt.orchestrator.get(c.run.id)!;
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("confirm_cart");
    expect(c.rt.store.slips.get(c.run.slipId!)!.status).toBe("active");
    expect(c.rt.mockRail.calls().slice(before).filter((x) => /void/i.test(x.method))).toEqual([]);
  });

  it("cancel at complete_signing still cancels", async () => {
    const c = await runToCartPrefix();
    holder.rt = c.rt;
    const res = await cancel(get("/api/paypal/cancel", c.run.slipId!, c.orderId));
    await Promise.all(pending);
    expect(res.status).toBe(303);
    expect(c.rt.store.slips.get(c.run.slipId!)!.status).toBe("rejected");
    expect(c.rt.orchestrator.get(c.run.id)?.status).not.toBe("waiting");
  });
});
