import { connection } from "next/server";
import pkg from "../../../../package.json";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/health -> {paypal: "sandbox" | "mock", ai: "anthropic" | "mock", version}. */
export async function GET() {
  await connection();
  const rt = getRuntime();
  return Response.json({ paypal: rt.rail.mode, ai: rt.ai.mode, version: pkg.version });
}
