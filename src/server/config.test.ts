import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("defaults to mock everything offline", () => {
    expect(resolveConfig({})).toEqual({ paypalMode: "mock", aiMode: "mock", baseUrl: "http://localhost:3000", dataDir: "./data" });
  });

  it("uses sandbox and anthropic only when keys exist", () => {
    const keys = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", ANTHROPIC_API_KEY: "k" };
    expect(resolveConfig(keys)).toMatchObject({ paypalMode: "sandbox", aiMode: "anthropic" });
    expect(resolveConfig({ PAYPAL_MODE: "sandbox", AI_MODE: "anthropic" })).toMatchObject({ paypalMode: "mock", aiMode: "mock" });
    expect(resolveConfig({ ...keys, PAYPAL_MODE: "mock", AI_MODE: "mock" })).toMatchObject({ paypalMode: "mock", aiMode: "mock" });
    expect(resolveConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: " ", PAYPAL_MODE: "sandbox" }).paypalMode).toBe("mock");
  });

  it("reads APP_BASE_URL and DATA_DIR", () => {
    expect(resolveConfig({ APP_BASE_URL: "https://slip.example.com/", DATA_DIR: "/var/data" })).toMatchObject({
      baseUrl: "https://slip.example.com",
      dataDir: "/var/data",
    });
  });

  it("falls back to RENDER_EXTERNAL_URL when APP_BASE_URL is empty", () => {
    expect(resolveConfig({ APP_BASE_URL: "", RENDER_EXTERNAL_URL: "https://permission-slip.onrender.com" }).baseUrl).toBe("https://permission-slip.onrender.com");
    expect(resolveConfig({ APP_BASE_URL: "https://slip.example.com", RENDER_EXTERNAL_URL: "https://x.onrender.com" }).baseUrl).toBe("https://slip.example.com");
  });
});
