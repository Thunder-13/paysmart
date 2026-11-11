import { handleCatalogGet, handleRegister } from "@/pipelines/toll-road/server";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the public price list. Each entry links to its toll booth URL. */
export async function GET() {
  return handleCatalogGet(getRuntime());
}

/** POST {publisher: {name, email}, title, body, price}: put a new article behind the booth. */
export async function POST(request: Request) {
  return handleRegister(getRuntime(), request);
}
