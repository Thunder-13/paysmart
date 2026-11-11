import type { NextRequest } from "next/server";
import { jsonError, readJson } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const BLOB_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/json"] as const;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/** POST /api/blobs {contentType, base64} -> 201 {ref, contentType, bytes}. 413 over 2 MB decoded. */
export async function POST(request: NextRequest) {
  const body = (await readJson(request)) as { contentType?: unknown; base64?: unknown } | undefined;
  const contentType = typeof body?.contentType === "string" ? body.contentType.toLowerCase().split(";")[0].trim() : "";
  if (!(BLOB_TYPES as readonly string[]).includes(contentType)) {
    return jsonError(415, `Unsupported content type "${contentType}". Use one of ${BLOB_TYPES.join(", ")}.`);
  }
  if (typeof body?.base64 !== "string" || body.base64.length === 0) return jsonError(400, "base64 is required");
  const base64 = body.base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return jsonError(400, "base64 is not valid base64");
  const bytes = Buffer.from(base64, "base64").length;
  if (bytes > MAX_BLOB_BYTES) return jsonError(413, `File is ${bytes} bytes; the limit is ${MAX_BLOB_BYTES} bytes (2 MB).`);
  const ref = getRuntime().store.blobs.put({ contentType, base64 });
  return Response.json({ ref, contentType, bytes }, { status: 201 });
}
