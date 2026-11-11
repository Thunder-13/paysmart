import { afterEach, describe, expect, it, vi } from "vitest";

const holder: { rail: { mode: "sandbox" | "mock" } } = { rail: { mode: "mock" } };

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));
vi.mock("@/server/runtime", () => ({ getRuntime: () => holder }));

import { GET, SANDBOX_SDK_URL } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  holder.rail.mode = "mock";
});

describe("GET /api/paypal/sdk-config", () => {
  it("says unavailable on the mock rail, even with a client id set", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "CLIENT-ID");
    const res = await GET();
    expect(await res.json()).toEqual({ available: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gives the sandbox script and client id, never the secret", async () => {
    holder.rail.mode = "sandbox";
    vi.stubEnv("PAYPAL_CLIENT_ID", "CLIENT-ID");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "TOP-SECRET-VALUE");
    const res = await GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ available: true, sdkUrl: SANDBOX_SDK_URL, clientId: "CLIENT-ID" });
    expect(SANDBOX_SDK_URL).toBe("https://www.sandbox.paypal.com/web-sdk/v6/core");
    expect(text).not.toContain("TOP-SECRET-VALUE");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("falls back to the link when the sandbox rail has no client id", async () => {
    holder.rail.mode = "sandbox";
    vi.stubEnv("PAYPAL_CLIENT_ID", "  ");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });
});
