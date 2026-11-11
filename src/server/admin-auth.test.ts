import { describe, expect, it } from "vitest";
import { checkAffiliateAdmin } from "./admin-auth";

function req(auth?: string): Request {
  return new Request("http://localhost/api/affiliates", { headers: auth ? { Authorization: auth } : {} });
}

describe("checkAffiliateAdmin", () => {
  it("answers 404 when the secret is empty or unset", () => {
    expect(checkAffiliateAdmin(req("Bearer x"), { AFFILIATE_ADMIN_SECRET: "" })?.status).toBe(404);
    expect(checkAffiliateAdmin(req("Bearer x"), { AFFILIATE_ADMIN_SECRET: "   " })?.status).toBe(404);
    expect(checkAffiliateAdmin(req(), {})?.status).toBe(404);
  });

  it("answers 401 for a missing bearer", () => {
    const res = checkAffiliateAdmin(req(), { AFFILIATE_ADMIN_SECRET: "s3cret" });
    expect(res?.status).toBe(401);
    expect(res?.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("answers 401 for a wrong bearer, including a different length, without throwing", () => {
    const env = { AFFILIATE_ADMIN_SECRET: "s3cret" };
    expect(checkAffiliateAdmin(req("Bearer nope!!"), env)?.status).toBe(401);
    expect(checkAffiliateAdmin(req("Bearer s"), env)?.status).toBe(401);
    expect(checkAffiliateAdmin(req("Bearer s3cret-and-more"), env)?.status).toBe(401);
    expect(checkAffiliateAdmin(req("Basic s3cret"), env)?.status).toBe(401);
  });

  it("returns null for the right bearer", () => {
    expect(checkAffiliateAdmin(req("Bearer s3cret"), { AFFILIATE_ADMIN_SECRET: "s3cret" })).toBeNull();
  });
});
