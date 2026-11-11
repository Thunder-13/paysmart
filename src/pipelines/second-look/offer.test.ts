import { describe, expect, it } from "vitest";
import { HONEST_OFFER_LINE, deterministicCard, honestOffer } from "./offer";

describe("second-look offer text", () => {
  it("honest offer contains the goods and services line, amount and seller email", () => {
    const text = honestOffer({ listingTitle: "PS5", amount: { currency: "USD", value: "180.00" }, sellerEmail: "dana@example.com" });
    expect(HONEST_OFFER_LINE).toBe("I'll pay through PayPal goods and services so we're both covered.");
    expect(text).toContain(HONEST_OFFER_LINE);
    expect(text).toContain("$180.00");
    expect(text).toContain("dana@example.com");
  });

  it("deterministic card names the tactics in plain words", () => {
    const card = deterministicCard([{ id: "ff_request" }, { id: "urgency" }], "high");
    expect(card.headline).toBe("High risk: 2 scam signs found");
    expect(card.explanation).toContain("friends and family request and pressure to hurry");
    expect(deterministicCard([], "low").headline).toMatch(/no known scam signs/);
  });
});
