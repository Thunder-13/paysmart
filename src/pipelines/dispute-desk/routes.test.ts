import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "./board";
import { SEED_MOCK_ONLY } from "./seed";
import { deskRuntime, notReceivedHistory } from "./testkit";

const holder = vi.hoisted(() => ({ rt: null as unknown }));
vi.mock("@/server/runtime", () => ({ getRuntime: () => holder.rt }));

import { GET } from "@/app/api/p/dispute-desk/disputes/route";
import { POST } from "@/app/api/p/dispute-desk/seed/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/p/dispute-desk/seed", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

describe("dispute-desk routes", () => {
  beforeEach(() => {
    holder.rt = deskRuntime();
  });

  it("GET returns six lanes with fixtures on a fresh runtime", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    expect(board.mode).toBe("mock");
    expect(board.lanes).toHaveLength(6);
    expect(board.total).toBe(4);
    expect(board.lanes[0].cards[0]).toMatchObject({ disputeId: "PP-D-DD-FX-01", urgency: "urgent", link: { method: "none", slipId: null } });
  });

  it("POST seed links a capture and the board shows the slip link", async () => {
    const rt = deskRuntime();
    holder.rt = rt;
    const { captureId, slipId } = await notReceivedHistory(rt);
    const res = await POST(post({ links: [{ captureId, scenario: "not_received" }] }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: unknown[] }).created).toHaveLength(1);
    const board = (await (await GET()).json()) as Board;
    const card = board.lanes[0].cards.find((c) => c.transactionId === captureId);
    expect(card?.link).toEqual({ method: "capture", slipId });
  });

  it("POST seed rejects a bad body with 400", async () => {
    const res = await POST(post({ links: [{ captureId: "CAP-1", scenario: "chargeback" }] }));
    expect(res.status).toBe(400);
  });

  it("POST seed returns 409 when the rail is sandbox", async () => {
    const rt = deskRuntime();
    holder.rt = { ...rt, rail: Object.assign(Object.create(rt.rail) as typeof rt.rail, { mode: "sandbox" as const }), mockRail: null };
    const res = await POST(post({ links: [{ captureId: "CAP-1", scenario: "not_received" }] }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(SEED_MOCK_ONLY);
  });
});
