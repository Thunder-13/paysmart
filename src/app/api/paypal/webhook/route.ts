import type { NextRequest } from "next/server";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";
import { recordWebhookEvent } from "@/server/webhook";

export const runtime = "nodejs";

/** POST /api/paypal/webhook: verify with PayPal, map resource ids to a slip, record, update status. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const rt = getRuntime();
  let verified = false;
  try {
    verified = await rt.rail.verifyWebhook(headers, raw);
  } catch {
    verified = false;
  }
  if (!verified) return jsonError(400, "Webhook signature did not verify");
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return jsonError(400, "Webhook body is not JSON");
  }
  const result = recordWebhookEvent(rt.store, event, rt.now());
  return Response.json({ ok: true, ...result });
}
