import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import { orderIdFromApproveUrl } from "./paypal-v6-button";
import { SignWithPayPal } from "./sign-with-paypal";

describe("orderIdFromApproveUrl", () => {
  it("reads the token parameter", () => {
    expect(orderIdFromApproveUrl("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T")).toBe("5O190127TN364715T");
    expect(orderIdFromApproveUrl("http://localhost:3000/mock-paypal/approve?slipId=s1&token=ORDER-1")).toBe("ORDER-1");
  });
  it("returns null without a token", () => {
    expect(orderIdFromApproveUrl("https://www.sandbox.paypal.com/checkoutnow")).toBeNull();
    expect(orderIdFromApproveUrl("https://www.sandbox.paypal.com/checkoutnow?token=")).toBeNull();
    expect(orderIdFromApproveUrl("")).toBeNull();
  });
});

describe("SignWithPayPal", () => {
  const url = "http://localhost:3000/mock-paypal/approve?token=ORDER-1";
  it("renders the plain link without the sdk prop", () => {
    const html = renderToStaticMarkup(createElement(SignWithPayPal, { approveUrl: url }));
    expect(html).toContain(`href="${url.replace(/&/g, "&amp;")}"`);
    expect(html).toContain("Sign with PayPal");
    expect(html).not.toContain("paypal-button");
    expect(html).not.toContain("aria-live");
  });
  it("renders the link on the server with sdk v6 and loads no script", () => {
    const html = renderToStaticMarkup(createElement(SignWithPayPal, { approveUrl: url, sdk: "v6" }));
    expect(html).toContain("Sign with PayPal");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("paypal-button");
  });
});
