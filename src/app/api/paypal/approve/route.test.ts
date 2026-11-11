import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runToCartPrefix } from "./test-support";
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

import { POST } from "./route";

function post(body: unknown): NextRequest {
  return new Request("http://localhost:3000/api/paypal/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  pending.length = 0;
});

describe("POST /api/paypal/approve", () => {
  it("resumes the waiting shop run and places the hold", async () => {
    const { rt, run, orderId } = await runToCartPrefix();
    holder.rt = rt;
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    const res = await POST(post({ orderId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: run.id, returnPath: "/p/shop" });
    await Promise.all(pending);
    const slip = rt.store.slips.get(run.slipId!)!;
    expect(slip.status).toBe("active");
    expect(rt.orchestrator.get(run.id)?.step).toBe("confirm_cart");
    expect(rt.store.ledger.list(slip.id).filter((e) => e.type === "slip.signed")).toHaveLength(1);
  });

  it("answers 409 on a second approval and keeps one authorization", async () => {
    const { rt, run, orderId } = await runToCartPrefix();
    holder.rt = rt;
    rt.mockRail.approveOrder(orderId, "buyer@example.com");
    expect((await POST(post({ orderId }))).status).toBe(200);
    await Promise.all(pending);
    const second = await POST(post({ orderId }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ runId: run.id });
    await Promise.all(pending);
    expect(rt.store.ledger.list(run.slipId!).filter((e) => e.type === "slip.signed")).toHaveLength(1);
    expect(rt.orchestrator.get(run.id)?.step).toBe("confirm_cart");
  });

  it("answers 404 for an unknown order and resumes nothing", async () => {
    const { rt, run } = await runToCartPrefix();
    holder.rt = rt;
    const res = await POST(post({ orderId: "NOT-A-REAL-ORDER" }));
    expect(res.status).toBe(404);
    expect(rt.orchestrator.get(run.id)?.status).toBe("waiting");
    expect(rt.orchestrator.get(run.id)?.step).toBe("complete_signing");
    expect(pending).toHaveLength(0);
  });

  it("rejects bad bodies with 400", async () => {
    const { rt } = await runToCartPrefix();
    holder.rt = rt;
    for (const body of [{}, { orderId: "" }, { orderId: "x".repeat(65) }, { orderId: 7 }, "not json"]) {
      expect((await POST(post(body))).status).toBe(400);
    }
  });
});
