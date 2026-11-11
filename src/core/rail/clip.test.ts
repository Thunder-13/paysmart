import { describe, expect, it } from "vitest";
import { money } from "../money";
import { coreRuntime, newSlipInput } from "../test-helpers";
import { clipText, PAYPAL_TEXT_MAX } from "./clip";
import { createSandboxRail } from "./sandbox";

// The Shop demo intent: "PaySmart: " plus this runs to 138 characters.
const SHOP_INTENT = "Birthday gift for my nephew Leo, turning 6, loves dinosaurs. Under $60. Has to arrive by Saturday. Nothing that needs batteries.";
const CLIPPED = "PaySmart: Birthday gift for my nephew Leo, turning 6, loves dinosaurs. Under $60. Has to arrive by Saturday. Nothing that…";

describe("clipText", () => {
  it("leaves text that fits alone", () => {
    expect(clipText("PaySmart: a toy")).toBe("PaySmart: a toy");
    const exact = "x".repeat(PAYPAL_TEXT_MAX);
    expect(clipText(exact)).toBe(exact);
  });

  it("cuts on a word boundary, adds an ellipsis and stays within 127 characters", () => {
    const out = clipText(`PaySmart: ${SHOP_INTENT}`);
    expect(out).toBe(CLIPPED);
    expect(out.length).toBeLessThanOrEqual(PAYPAL_TEXT_MAX);
    expect(out).not.toContain("Nothing tha…");
    expect(clipText(out)).toBe(out);
  });

  it("keeps a word that ends exactly at the cut and drops trailing punctuation", () => {
    expect(clipText("alpha beta gamma", 11)).toBe("alpha beta…");
    expect(clipText("alpha, beta gamma", 8)).toBe("alpha…");
    expect(clipText("one two. three four", 13)).toBe("one two…");
  });

  it("cuts one very long word hard rather than losing most of the text", () => {
    const out = clipText(`see https://example.com/${"a".repeat(200)}`);
    expect(out.length).toBe(PAYPAL_TEXT_MAX);
    expect(out.endsWith("a…")).toBe(true);
  });

  it("never leaves half a surrogate pair", () => {
    const out = clipText(`${"x".repeat(9)}🦕🦕`, 11);
    expect(out).toBe(`${"x".repeat(9)}…`);
  });
});

describe("order descriptions", () => {
  it("the mock approve page gets whole words from beginSigning", async () => {
    const rt = coreRuntime();
    const slip = rt.core.createSlip(newSlipInput({ intent: SHOP_INTENT }));
    const { orderId } = await rt.core.beginSigning(slip.id, { intent: "AUTHORIZE", returnPath: "/p/shop" });
    expect(rt.mockRail.inspectOrder(orderId)?.description).toBe(CLIPPED);
  });

  it("the sandbox order payload carries the same clean text", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/v1/oauth2/token") return Response.json({ access_token: "T", expires_in: 32400 });
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "O1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://paypal.test/approve" }] }, { status: 201 });
    }) as typeof fetch;
    const rail = createSandboxRail({ clientId: "cid", clientSecret: "secret", webhookId: "WH-1", fetch: fetchImpl });
    await rail.createOrder({
      intent: "AUTHORIZE",
      amount: money("60.00"),
      description: `PaySmart: ${SHOP_INTENT}`,
      customId: "slip_x",
      returnUrl: "r",
      cancelUrl: "c",
    });
    expect(bodies[0]).toMatchObject({ purchase_units: [{ description: CLIPPED }] });
  });
});
