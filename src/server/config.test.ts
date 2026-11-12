import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("defaults to mock everything offline", () => {
    expect(resolveConfig({})).toEqual({ paypalMode: "mock", aiMode: "mock", baseUrl: "http://localhost:3000", dataDir: "./data", libsqlUrl: null, libsqlAuthToken: null });
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

  it("reads the Turso url and token, null when empty", () => {
    expect(resolveConfig({ TURSO_DATABASE_URL: "libsql://db.turso.io", TURSO_AUTH_TOKEN: "tok" })).toMatchObject({
      libsqlUrl: "libsql://db.turso.io",
      libsqlAuthToken: "tok",
    });
    expect(resolveConfig({ TURSO_DATABASE_URL: " ", TURSO_AUTH_TOKEN: "" })).toMatchObject({ libsqlUrl: null, libsqlAuthToken: null });
  });

  it("uses Vercel's URLs and /tmp on Vercel", () => {
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "paysmart-abc.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "paysmart.vercel.app" };
    expect(resolveConfig(preview)).toMatchObject({ baseUrl: "https://paysmart-abc.vercel.app", dataDir: "/tmp/paysmart" });
    expect(resolveConfig({ ...preview, VERCEL_ENV: "production" }).baseUrl).toBe("https://paysmart.vercel.app");
    expect(resolveConfig({ ...preview, APP_BASE_URL: "https://slip.example.com", DATA_DIR: "/data" })).toMatchObject({
      baseUrl: "https://slip.example.com",
      dataDir: "/data",
    });
  });
});
