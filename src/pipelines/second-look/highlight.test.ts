import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { markLines } from "./highlight";

describe("second-look highlighting", () => {
  it("marks every scam fixture quote", () => {
    const { script, chatText, listingText } = FIXTURES.scam;
    const marked = [...markLines(chatText, script.tactics), ...markLines(listingText, script.tactics)];
    for (const t of script.tactics) {
      expect(marked.some((l) => l.tactics.includes(t.id)), t.id).toBe(true);
    }
    const ff = marked.find((l) => l.tactics.includes("ff_request"));
    expect(ff?.text).toBe("Dana: just send it friends and family so PayPal doesn't take a cut");
  });

  it("leaves unrelated lines unmarked, including short ones", () => {
    const marked = markLines("hi\nDana: just send it friends and family", [{ id: "ff_request", quote: "just send it friends and family" }]);
    expect(marked[0]).toEqual({ index: 0, text: "hi", tactics: [] });
    expect(marked[1].tactics).toEqual(["ff_request"]);
  });
});
