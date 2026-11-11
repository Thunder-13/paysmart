import { describe, expect, it, vi } from "vitest";
import { money } from "@/core/money";
import { Channel3Error, CHANNEL3_URL, channel3Body, mapChannel3Response, searchChannel3 } from "./channel3";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
}

const SAMPLE = {
  products: [
    {
      id: "p1",
      title: "Walking T-rex toy",
      description: "Wind-up dinosaur toy.",
      image_url: "https://img.example/brand.png",
      offers: [
        { url: "https://shop-a.example/rex", domain: "shop-a.example", price: { price: 44.5, compare_at_price: 50, currency: "USD" }, availability: "InStock" },
        { url: "https://shop-b.example/rex", domain: "shop-b.example", price: { price: 42.18, compare_at_price: null, currency: "USD" }, availability: "InStock" },
        { url: "https://shop-c.example/rex", domain: "shop-c.example", price: { price: 9.99, currency: "USD" }, availability: "OutOfStock" },
      ],
    },
    { id: "p2", title: "Gone", offers: [{ url: "https://x.example", price: { price: 5, currency: "USD" }, availability: "OutOfStock" }] },
  ],
};

describe("Channel3 client", () => {
  it("posts the documented request shape with the api key", async () => {
    const f = fakeFetch(200, SAMPLE);
    await searchChannel3({ apiKey: "k-123", fetch: f as unknown as typeof fetch }, { query: "dinosaur toy", limit: 99, maxPrice: money("60.00") });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(CHANNEL3_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("k-123");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      query: "dinosaur toy",
      limit: 30,
      filters: { price: { max_price: 60 }, availability: ["InStock"] },
      config: { mode: "agentic" },
    });
  });

  it("maps the cheapest in-stock offer to Money and drops images", () => {
    const listings = mapChannel3Response(SAMPLE);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      id: "c3-p1",
      price: { currency: "USD", value: "42.18" },
      domain: "shop-b.example",
      source: "channel3",
    });
    expect(JSON.stringify(listings[0])).not.toContain("img.example");
    expect(channel3Body({ query: "x" }).limit).toBe(10);
  });

  it("drops a listing the API returns above the cap, even though the filter asked for less", async () => {
    const offer = (price: number) => [{ url: "https://shop-a.example/x", domain: "shop-a.example", price: { price, currency: "USD" }, availability: "InStock" }];
    const over = {
      products: [
        { id: "cheap", title: "Cheap", offers: offer(59.99) },
        { id: "exact", title: "Exact", offers: offer(60) },
        { id: "dear", title: "Dear", offers: offer(60.01) },
      ],
    };
    const out = await searchChannel3({ apiKey: "k", fetch: fakeFetch(200, over) as unknown as typeof fetch }, { query: "x", maxPrice: money("60.00") });
    expect(out.map((l) => l.id)).toEqual(["c3-cheap", "c3-exact"]);
    const all = await searchChannel3({ apiKey: "k", fetch: fakeFetch(200, over) as unknown as typeof fetch }, { query: "x" });
    expect(all).toHaveLength(3);
  });

  it("throws a typed error on HTTP failure", async () => {
    const f = fakeFetch(500, "boom");
    await expect(searchChannel3({ apiKey: "k", fetch: f as unknown as typeof fetch }, { query: "x" })).rejects.toBeInstanceOf(Channel3Error);
  });
});
