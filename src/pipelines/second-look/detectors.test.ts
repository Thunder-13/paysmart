import { describe, expect, it } from "vitest";
import { detect, detectorFloor } from "./detectors";
import { FIXTURES } from "./fixtures";

const one = (text: string) => detect([{ source: "chat", text }]);

describe("second-look detectors", () => {
  it("maps each listed phrase to its tactic", () => {
    const cases: [string, string][] = [
      ["just send it friends and family", "ff_request"],
      ["Friends & Family please", "ff_request"],
      ["send F&F so there are no fees", "ff_request"],
      ["FnF only", "ff_request"],
      ["I take Apple gift cards", "gift_card_or_crypto"],
      ["can you pay in crypto?", "gift_card_or_crypto"],
      ["bitcoin is fine too", "gift_card_or_crypto"],
      ["I can do a wire transfer", "off_platform"],
      ["Zelle me the money", "off_platform"],
      ["this price is today only", "urgency"],
      ["I need a deposit first to hold it", "advance_fee"],
    ];
    for (const [line, id] of cases) {
      expect(one(line).map((f) => f.id), line).toContain(id);
    }
  });

  it("quotes the full matched line", () => {
    const findings = one("Dana: hello\nDana: just send it friends and family so PayPal doesn't take a cut\nok");
    expect(findings).toEqual([
      { id: "ff_request", quote: "Dana: just send it friends and family so PayPal doesn't take a cut", source: "chat" },
    ]);
  });

  it("does not flag wireless", () => {
    expect(one("The wireless remote is in the box too.")).toEqual([]);
    expect(one("Front and rear caps and a wireless remote included.")).toEqual([]);
  });

  it("scam fixture lines trigger ff_request and urgency", () => {
    const ids = detect([
      { source: "chat", text: FIXTURES.scam.chatText },
      { source: "listing", text: FIXTURES.scam.listingText },
    ]).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["ff_request", "urgency"]));
  });

  it("legit fixture triggers nothing and contains the word wireless", () => {
    expect(FIXTURES.legit.chatText.toLowerCase()).toContain("wireless");
    expect(detect([{ source: "chat", text: FIXTURES.legit.chatText }, { source: "listing", text: FIXTURES.legit.listingText }])).toEqual([]);
  });

  it("floor is the capped sum of weights, counting each tactic once", () => {
    expect(detectorFloor(one("friends and family\ntoday only"))).toBe(60);
    expect(detectorFloor(one("friends and family, gift card, deposit first, Zelle, today only"))).toBe(100);
    expect(detectorFloor([])).toBe(0);
  });
});
