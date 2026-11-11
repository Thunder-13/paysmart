import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "permission-slip-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getRuntime", () => {
  it("builds a mock runtime from env, writes SQLite under DATA_DIR, and caches on globalThis", async () => {
    process.env.DATA_DIR = dir;
    process.env.PAYPAL_MODE = "sandbox"; // no keys, so it must fall back to mock
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.ANTHROPIC_API_KEY;
    const { getRuntime } = await import("./runtime");
    const rt = getRuntime();
    expect(rt.rail.mode).toBe("mock");
    expect(rt.ai.mode).toBe("mock");
    expect(rt.mockRail).not.toBeNull();
    expect(getRuntime()).toBe(rt);
    expect(existsSync(path.join(dir, "permission-slip.db"))).toBe(true);
    const slip = rt.core.createSlip({
      pipeline: "shop",
      principal: { name: "Ada", email: null },
      intent: "smoke",
      clauses: [{ id: "c1", kind: "budget_max", label: "Up to $5", amount: { currency: "USD", value: "5.00" } }],
      budget: { currency: "USD", value: "5.00" },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(rt.store.ledger.verifyChain(slip.id).ok).toBe(true);
  });
});
