import { connection, type NextRequest } from "next/server";
import { jsonError } from "@/server/http";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

/** GET /api/blobs/[ref] -> the stored bytes with their content type. Blobs never change. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/blobs/[ref]">) {
  await connection();
  const { ref } = await ctx.params;
  const blob = getRuntime().store.blobs.get(ref);
  if (!blob) return jsonError(404, `blob ${ref} not found`);
  const bytes = Buffer.from(blob.base64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
