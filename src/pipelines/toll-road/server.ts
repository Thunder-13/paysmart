/**
 * Request handlers behind the Toll Road API routes. The route files stay thin and pass in the
 * runtime, so tests drive these with createTestRuntime() and no server.
 */
import type { PayPalRail, Runtime } from "@/core/contracts";
import { formatMoney } from "@/core/money";
import { ensureCatalog, parsePublisherEmails, readCatalog, registerContent } from "./catalog";
import { tollBooth, type GatewayDeps } from "./gateway";
import { gatewayPath, SLIP_HEADER } from "./types";

type Rt = Pick<Runtime, "store" | "guard" | "now" | "baseUrl" | "rail">;

/** Sandbox payout receivers replace the fictional seed emails; mock mode keeps the seed. */
export function catalogEmails(rail: Pick<PayPalRail, "mode">): string[] {
  return rail.mode === "sandbox" ? parsePublisherEmails(process.env.TOLL_ROAD_PUBLISHER_EMAILS) : [];
}

export function prepareCatalog(rt: Pick<Runtime, "store" | "rail">): void {
  ensureCatalog(rt.store, { emails: catalogEmails(rt.rail) });
}

export function boothDeps(rt: Pick<Runtime, "store" | "guard" | "now" | "baseUrl">): GatewayDeps {
  return { store: rt.store, guard: rt.guard, now: () => rt.now(), baseUrl: rt.baseUrl };
}

/** GET /api/p/toll-road/content/[id] */
export function handleGatewayGet(rt: Rt, contentId: string, headers: Headers): Response {
  prepareCatalog(rt);
  const res = tollBooth(boothDeps(rt), contentId, headers.get(SLIP_HEADER));
  return Response.json(res.body, { status: res.status, headers: res.headers });
}

/** GET /api/p/toll-road/content: the public price list (no bodies, no payout emails). */
export function handleCatalogGet(rt: Rt): Response {
  prepareCatalog(rt);
  const { publishers, content } = readCatalog(rt.store);
  const names = new Map(publishers.map((p) => [p.id, p.name]));
  return Response.json(
    {
      content: content.map((c) => ({
        id: c.id,
        title: c.title,
        publisher: names.get(c.publisherId) ?? "unknown",
        price: c.price.value,
        currency: c.price.currency,
        priceLabel: formatMoney(c.price),
        url: `${rt.baseUrl}${gatewayPath(c.id)}`,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST /api/p/toll-road/content */
export async function handleRegister(rt: Rt, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_registration", errors: [{ field: "body", message: "Send a JSON body." }] }, { status: 400 });
  }
  prepareCatalog(rt);
  const res = registerContent(rt.store, body, rt.now());
  if (!res.ok) return Response.json({ error: "invalid_registration", errors: res.errors }, { status: 400 });
  return Response.json(
    {
      contentId: res.content.id,
      publisherId: res.publisher.id,
      price: res.content.price.value,
      gatewayUrl: `${rt.baseUrl}${res.gatewayPath}`,
    },
    { status: 201 },
  );
}
