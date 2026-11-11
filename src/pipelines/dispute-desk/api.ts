/** Server-side handlers behind /api/p/dispute-desk/*. Route files stay thin wrappers around these. */
import { buildBoard, type Board } from "./board";
import { linkDispute } from "./link";
import { controlsOf, DemoLinksSchema, ensureFixtureDisputes, SEED_MOCK_ONLY, seedDemoDisputes, type SeedRuntime } from "./seed";
import { casesOf } from "./steps";

export async function loadBoard(rt: SeedRuntime): Promise<Board> {
  const mock = controlsOf(rt) !== null;
  if (mock) await ensureFixtureDisputes(rt);
  const disputes = await rt.rail.listDisputes();
  const cases = casesOf(rt.store);
  return buildBoard({
    disputes,
    now: rt.now(),
    mode: mock ? "mock" : "sandbox",
    linkOf: (d) => linkDispute(rt.store, d.transactionId).link,
    caseOf: (id) => cases.get(id),
  });
}

function errorJson(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function boardResponse(rt: SeedRuntime): Promise<Response> {
  try {
    return Response.json(await loadBoard(rt));
  } catch (e) {
    return errorJson(502, e instanceof Error ? e.message : String(e));
  }
}

export async function seedResponse(rt: SeedRuntime, body: unknown): Promise<Response> {
  if (!controlsOf(rt)) return errorJson(409, SEED_MOCK_ONLY);
  const links = DemoLinksSchema.safeParse((body as { links?: unknown } | undefined)?.links);
  if (!links.success) {
    return errorJson(400, `Send { links: [{ captureId, scenario: "not_received" | "not_as_described" | "unlinked" }] }. ${links.error.issues.map((i) => i.message).join(" ")}`);
  }
  return Response.json(await seedDemoDisputes(rt, links.data));
}
