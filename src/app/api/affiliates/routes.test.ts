import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { affiliateRepo, type AffiliateAccount } from "@/core/affiliate";
import { createTestRuntime } from "@/core/testing";

const holder = vi.hoisted(() => ({ rt: null as unknown }));
vi.mock("@/server/runtime", () => ({ getRuntime: () => holder.rt }));

import { DELETE, PATCH } from "@/app/api/affiliates/[id]/route";
import { POST as PREVIEW } from "@/app/api/affiliates/preview/route";
import { GET, POST } from "@/app/api/affiliates/route";

const SECRET = "test-admin-secret";

function call(method: string, body?: unknown, auth: string | null = `Bearer ${SECRET}`): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  return new Request("http://localhost/api/affiliates", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("affiliate admin routes", () => {
  let rt: ReturnType<typeof createTestRuntime>;
  beforeEach(() => {
    vi.stubEnv("AFFILIATE_ADMIN_SECRET", SECRET);
    rt = createTestRuntime();
    holder.rt = rt;
  });
  afterEach(() => vi.unstubAllEnvs());
  const repo = () => affiliateRepo(rt.store);

  it("creates, lists, patches and deletes", async () => {
    const created = await POST(call("POST", { network: "amazon", trackingId: "leoshop-21", commissionBps: 400 }));
    expect(created.status).toBe(201);
    const { account } = (await created.json()) as { account: AffiliateAccount };
    expect(account).toMatchObject({ network: "amazon", params: { tag: "{id}" }, commissionBps: 400, active: true });

    const listed = (await (await GET(call("GET"))).json()) as { accounts: AffiliateAccount[]; presets: Record<string, unknown> };
    expect(listed.accounts.map((a) => a.id)).toEqual([account.id]);
    expect(Object.keys(listed.presets)).toEqual(["amazon", "flipkart", "myntra", "instagram", "facebook", "generic"]);

    const patched = await PATCH(call("PATCH", { active: false, trackingId: "newtag-21" }), ctx(account.id));
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { account: AffiliateAccount }).account).toMatchObject({ active: false, trackingId: "newtag-21" });

    const deleted = await DELETE(call("DELETE"), ctx(account.id));
    expect(deleted.status).toBe(200);
    expect(repo().list()).toEqual([]);
  });

  it("returns 404 for an unknown id on patch and delete", async () => {
    expect((await PATCH(call("PATCH", { active: false }), ctx("aff_nope"))).status).toBe(404);
    expect((await DELETE(call("DELETE"), ctx("aff_nope"))).status).toBe(404);
  });

  it("previews a link, and returns null link when nothing matches", async () => {
    repo().create({ network: "amazon", trackingId: "leoshop-21" });
    const hit = (await (await PREVIEW(call("POST", { url: "https://www.amazon.in/dp/B0TEST" }))).json()) as { url: string; link: { url: string } | null };
    expect(new URL(hit.link!.url).searchParams.get("tag")).toBe("leoshop-21");
    const miss = (await (await PREVIEW(call("POST", { url: "https://notamazon.in/dp/X" }))).json()) as { link: unknown };
    expect(miss.link).toBeNull();
    expect((await PREVIEW(call("POST", { url: 5 }))).status).toBe(400);
  });

  it("returns 400 with issues on bad input", async () => {
    const res = await POST(call("POST", { network: "instagram", trackingId: "leo.gifts" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { message: string }[] };
    expect(body.error).toMatch(/Instagram needs a template or parameters/);
    expect(body.issues.length).toBeGreaterThan(0);
    expect((await POST(call("POST", { network: "nope", trackingId: "x" }))).status).toBe(400);
    expect((await POST(call("POST", [1]))).status).toBe(400);
    expect((await POST(call("POST", { network: "amazon", trackingId: "a b" }))).status).toBe(400);
    expect(repo().list()).toEqual([]);
  });

  it("answers 404 and changes nothing when no secret is configured", async () => {
    vi.stubEnv("AFFILIATE_ADMIN_SECRET", "");
    expect((await POST(call("POST", { network: "amazon", trackingId: "leoshop-21" }))).status).toBe(404);
    expect((await GET(call("GET"))).status).toBe(404);
    expect((await PREVIEW(call("POST", { url: "https://amazon.in/x" }))).status).toBe(404);
    expect(repo().list()).toEqual([]);
  });

  it("answers 401 for a wrong or missing bearer and changes nothing", async () => {
    const a = repo().create({ network: "amazon", trackingId: "leoshop-21" });
    for (const auth of ["Bearer wrong", null]) {
      expect((await POST(call("POST", { network: "flipkart", trackingId: "x1" }, auth))).status).toBe(401);
      expect((await GET(call("GET", undefined, auth))).status).toBe(401);
      expect((await PATCH(call("PATCH", { active: false }, auth), ctx(a.id))).status).toBe(401);
      expect((await DELETE(call("DELETE", undefined, auth), ctx(a.id))).status).toBe(401);
      expect((await PREVIEW(call("POST", { url: "https://amazon.in/x" }, auth))).status).toBe(401);
    }
    expect(repo().list()).toEqual([a]);
  });
});
