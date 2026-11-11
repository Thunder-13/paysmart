import { connection, NextResponse } from "next/server";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** PayPal's v6 sandbox core script (confirmed in design.md, Sources). */
export const SANDBOX_SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

/**
 * Tells the browser whether the PayPal JS SDK v6 button can run. One-time PayPal payments take the
 * public client ID (PayPal's set-up page: client tokens are for Fastlane), so no token is issued here.
 * The client secret and REST access tokens never appear in this response.
 */
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  const rt = getRuntime();
  const clientId = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
  if (rt.rail.mode !== "sandbox" || clientId === "") {
    return NextResponse.json({ available: false }, { headers });
  }
  return NextResponse.json({ available: true, sdkUrl: SANDBOX_SDK_URL, clientId }, { headers });
}
