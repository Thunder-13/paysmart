import { describe, expect, it } from "vitest";
import { createTestRuntime } from "@/core/testing";
import { handleCatalogGet, handleGatewayGet, handleRegister } from "./server";
import { activeTollSlip } from "./test-helpers";
import { SLIP_HEADER } from "./types";

function post(body: unknown): Request {
  return new Request("http://localhost:3000/api/p/toll-road/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("toll-road routes", () => {
  it("GET without header returns 402 with WWW-Authenticate", async () => {
    const rt = createTestRuntime();
    const res = handleGatewayGet(rt, "tw-1", new Headers());
    expect(res.status).toBe(402);
    expect(res.headers.get("www-authenticate")).toBe('PermissionSlip realm="toll-road"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "payment_required", reason: "no_slip", price: "0.02", currency: "USD", publisher: "Tidewater Field Notes" });
  });

  it("GET with an active toll slip returns the article", async () => {
    const rt = createTestRuntime();
    handleGatewayGet(rt, "tw-1", new Headers()); // seeds the catalog
    const slip = await activeTollSlip(rt);
    const res = handleGatewayGet(rt, "tw-1", new Headers({ [SLIP_HEADER]: slip.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-toll-charged")).toBe("0.02");
    const body = (await res.json()) as { charged: { value: string }; body: string };
    expect(body.charged.value).toBe("0.02");
    expect(body.body.length).toBeGreaterThan(100);
  });

  it("GET unknown content returns 404", async () => {
    const res = handleGatewayGet(createTestRuntime(), "missing", new Headers());
    expect(res.status).toBe(404);
  });

  it("valid registration returns 201 with gateway URL", async () => {
    const rt = createTestRuntime();
    const res = await handleRegister(
      rt,
      post({ publisher: { name: "Harbor Weekly", email: "harbor@example.com" }, title: "Tide tables", body: "High tide is at noon.", price: "0.03" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contentId: string; gatewayUrl: string };
    expect(body.gatewayUrl).toBe(`http://localhost:3000/api/p/toll-road/content/${body.contentId}`);
    const quote = handleGatewayGet(rt, body.contentId, new Headers());
    expect(((await quote.json()) as { price: string }).price).toBe("0.03");
  });

  it("bad price returns 400 naming price", async () => {
    const rt = createTestRuntime();
    const res = await handleRegister(rt, post({ publisher: { name: "P", email: "p@example.com" }, title: "T", body: "B", price: "2.50" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string }[] };
    expect(body.errors.map((e) => e.field)).toContain("price");
    expect((await handleRegister(rt, post("not json"))).status).toBe(400);
  });

  it("catalog lists prices without bodies or payout emails", async () => {
    const res = handleCatalogGet(createTestRuntime());
    const text = await res.text();
    expect(JSON.parse(text).content).toHaveLength(6);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("rolling boil");
  });
});
