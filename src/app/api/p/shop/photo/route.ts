import { connection, type NextRequest } from "next/server";
import { readPhoto } from "@/pipelines/shop/api";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/p/shop/photo?ref=... -> a stored delivery photo (image types only). */
export async function GET(request: NextRequest) {
  await connection();
  const ref = request.nextUrl.searchParams.get("ref") ?? "";
  const photo = readPhoto(getRuntime(), ref);
  if (!photo) return Response.json({ error: "photo not found" }, { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
