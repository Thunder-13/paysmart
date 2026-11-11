import { describe, expect, it } from "vitest";
import { money } from "@/core/money";
import { affiliateLink, buildAffiliateUrl, estimateCommission, matchAccount, type AffiliateAccount } from "./index";

let n = 0;
function acct(over: Partial<AffiliateAccount>): AffiliateAccount {
  n += 1;
  return {
    id: `aff_${n}`,
    network: "amazon",
    label: "Test",
    trackingId: "leoshop-21",
    domains: ["amazon.com", "amazon.in"],
    params: { tag: "{id}" },
    template: null,
    commissionBps: null,
    active: true,
    createdAt: `2026-01-0${n % 9 || 1}T00:00:00.000Z`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("affiliateLink", () => {
  const amazon = acct({});

  it("adds the Amazon tag and keeps other params and the host", () => {
    const link = affiliateLink("https://www.amazon.in/dp/B0TEST?th=1", [amazon]);
    const u = new URL(link!.url);
    expect(u.host).toBe("www.amazon.in");
    expect(u.searchParams.get("th")).toBe("1");
    expect(u.searchParams.get("tag")).toBe("leoshop-21");
    expect(link).toMatchObject({ accountId: amazon.id, network: "amazon", label: "Test", commissionBps: null });
  });

  it("replaces someone else's tag so exactly one tag remains", () => {
    const link = affiliateLink("https://www.amazon.com/dp/B0TEST?tag=other-20", [amazon]);
    const u = new URL(link!.url);
    expect(u.searchParams.getAll("tag")).toEqual(["leoshop-21"]);
  });

  it("adds the Flipkart affid", () => {
    const flip = acct({ network: "flipkart", trackingId: "leoflip", domains: ["flipkart.com"], params: { affid: "{id}" } });
    const link = affiliateLink("https://www.flipkart.com/p/itm1?pid=X", [flip]);
    expect(new URL(link!.url).searchParams.get("affid")).toBe("leoflip");
  });

  it("template mode encodes the URL and the id", () => {
    const t = acct({
      network: "myntra",
      trackingId: "my.sub-1",
      domains: ["myntra.com"],
      params: {},
      template: "https://track.example/go?u={url}&s={id}",
    });
    const raw = "https://www.myntra.com/shoes?a=1&b=2";
    expect(buildAffiliateUrl(raw, t)).toBe(`https://track.example/go?u=${encodeURIComponent(raw)}&s=my.sub-1`);
  });

  it("template mode returns null when the result is not https", () => {
    const t = acct({ domains: ["myntra.com"], params: {}, template: "http://track.example/?u={url}" });
    expect(buildAffiliateUrl("https://www.myntra.com/x", t)).toBeNull();
  });

  it("does not match look-alike hosts", () => {
    expect(affiliateLink("https://notamazon.in/dp/X", [amazon])).toBeNull();
    expect(affiliateLink("https://amazon.in.evil.example/dp/X", [amazon])).toBeNull();
    expect(affiliateLink("https://evil.example/?u=amazon.in", [amazon])).toBeNull();
  });

  it("matches the bare domain and a subdomain", () => {
    expect(matchAccount("https://amazon.in/dp/X", [amazon])).toBe(amazon);
    expect(matchAccount("https://smile.www.amazon.in/dp/X", [amazon])).toBe(amazon);
  });

  it("skips inactive accounts", () => {
    expect(affiliateLink("https://www.amazon.in/dp/X", [acct({ active: false })])).toBeNull();
  });

  it("rewrites only http and https", () => {
    expect(affiliateLink("ftp://amazon.in/dp/X", [amazon])).toBeNull();
    expect(affiliateLink("javascript:alert(1)", [amazon])).toBeNull();
    expect(affiliateLink("not a url", [amazon])).toBeNull();
    expect(affiliateLink(null, [amazon])).toBeNull();
  });

  it("longest matching domain wins, then the oldest account", () => {
    const broad = acct({ domains: ["example.com"], params: { ref: "broad" }, createdAt: "2026-01-01T00:00:00.000Z" });
    const narrow = acct({ domains: ["shop.example.com"], params: { ref: "narrow" }, createdAt: "2026-02-01T00:00:00.000Z" });
    expect(matchAccount("https://shop.example.com/p/1", [broad, narrow])).toBe(narrow);
    expect(matchAccount("https://other.example.com/p/1", [narrow, broad])).toBe(broad);
    const older = acct({ domains: ["same.example"], createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = acct({ domains: ["same.example"], createdAt: "2026-03-01T00:00:00.000Z" });
    expect(matchAccount("https://same.example/", [newer, older])).toBe(older);
  });

  it("is deterministic", () => {
    const a = affiliateLink("https://www.amazon.in/dp/B0TEST?th=1", [amazon]);
    expect(affiliateLink("https://www.amazon.in/dp/B0TEST?th=1", [amazon])).toEqual(a);
  });
});

describe("estimateCommission", () => {
  it("floors to the cent: $42.18 at 400 bps is $1.68", () => {
    expect(estimateCommission(money("42.18"), 400)).toEqual({ currency: "USD", value: "1.68" });
  });
  it("returns null without a rate and zero for 0 bps", () => {
    expect(estimateCommission(money("42.18"), null)).toBeNull();
    expect(estimateCommission(money("42.18"), 0)).toEqual({ currency: "USD", value: "0.00" });
  });
  it("keeps the currency", () => {
    expect(estimateCommission(money("10.00", "EUR"), 250)).toEqual({ currency: "EUR", value: "0.25" });
  });
});
