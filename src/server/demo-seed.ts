/**
 * The demo story: all seven pipelines run to completion through the real orchestrator in mock mode.
 * Every wait is driven the way a person would drive it: PayPal approvals on the mock rail, slip and
 * cart confirmations, the pipelines' own sample photos. Shared by `npm run demo:seed`
 * (scripts/demo-seed.ts) and POST /api/demo/seed (the home page button).
 *
 *   1 Shop, red-team on, helper on: OUTSIDE on the hijacked cart, WITHIN on the clean one, capture,
 *     helper payout, delivery check, refund on the breach
 *   2 Second Look: a protected goods payment to the legit seller, shipped with tracking
 *     (plus a scam chat whose seller refuses the honest offer)
 *   3 Bounty Board: two pledges held, a claim, fresh photos, captures and a payout to the worker
 *   4 Cash Weather: forecast, reminders approved, patronage payout to maintainers
 *   5 Toll Road: HTTP 402 crawl under a toll slip, one capture, publisher payouts
 *   6 Dispute Desk: disputes seeded on the real captures above, the not-received one answered
 *   7 PaySmart: the demo ask, the first cart chosen, approved on the mock rail, delivery skipped
 *
 * Idempotent: the story record in store.collection("core", "demo-story") says whether it is loaded.
 */
import { affiliateRepo, type AffiliateAccount } from "@/core/affiliate";
import type { MockRailControls, PipelineId, Run, RunStatus, Runtime, Slip, SlipStatus } from "@/core/contracts";
import { formatMoney, money } from "@/core/money";
import { createOrchestrator, type AppOrchestrator } from "@/core/orchestrator";
import { FIXTURES as BOUNTY_PHOTOS, SECOND_PASSING_PAIR } from "@/pipelines/bounty/fixtures";
import { bounties } from "@/pipelines/bounty/records";
import type { BountyState } from "@/pipelines/bounty/schema";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "@/pipelines/cash-weather/fixtures";
import { demoDisputeId, seedDemoDisputes, type DemoLink } from "@/pipelines/dispute-desk/seed";
import type { DisputeDeskState } from "@/pipelines/dispute-desk/types";
import { pipelines as registry } from "@/pipelines/registry";
import { fixtureInput, protectedFlow, startToSeller } from "@/pipelines/second-look/demo-flows";
import { createPaySmartPipeline } from "@/pipelines/paysmart";
import { PAYSMART_DEMO_ASK, type PaySmartState } from "@/pipelines/paysmart/types";
import { createShopPipeline } from "@/pipelines/shop";
import { resolveConfig } from "./config";
import { chainFigures, moneyFigures, type MoneyFigures } from "./ledger-figures";
import { DEMO_STORY_KEY, demoStories, readDemoStory, restoreDemoDisputes, type DemoStoryDoc, type DemoStoryRun } from "./demo-restore";

export { readDemoStory, type DemoStoryDoc } from "./demo-restore";

/** What seeding needs: a runtime whose rail is the mock rail (ServerRuntime and TestRuntime fit). */
export type DemoRuntime = Runtime & { mockRail: (MockRailControls & { approveOrder(orderId: string, payerEmail: string): void }) | null };

export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSeedError";
  }
}

const HOUR = 3_600_000;
const BUYER = { name: "Ada Park", email: "ada.park@example.com" };
const UNLINKED_CAPTURE = "DEMO-CAP-UNLINKED-0001";

function mockControls(rt: DemoRuntime): NonNullable<DemoRuntime["mockRail"]> {
  if (rt.rail.mode !== "mock" || !rt.mockRail) throw new DemoSeedError("The demo story needs the mock PayPal rail (PAYPAL_MODE=mock).");
  if (rt.ai.mode !== "mock") throw new DemoSeedError("The demo story needs the scripted AI (AI_MODE=mock), so every run follows the demo script.");
  return rt.mockRail;
}

/**
 * An orchestrator over the same store and rail, with the Shop and PaySmart pipelines pinned to
 * their offline catalog: a CHANNEL3_API_KEY in the environment must not send the scripted demo agent to the
 * live catalog. Runs it creates are ordinary runs in the shared runs collection.
 */
function seedOrchestrator(rt: DemoRuntime): AppOrchestrator {
  return createOrchestrator({
    pipelines: {
      ...registry,
      shop: createShopPipeline({ channel3ApiKey: () => null }),
      paysmart: createPaySmartPipeline({ channel3ApiKey: () => null }),
    },
    deps: {
      rail: rt.rail,
      ai: rt.ai,
      extractor: rt.extractor,
      guard: rt.guard,
      store: rt.store,
      core: rt.core,
      baseUrl: rt.baseUrl,
      now: () => rt.now(),
    },
  });
}

function where(run: Run): string {
  return `${run.pipeline} run ${run.id} is ${run.status} at "${run.step}"${run.error ? `: ${run.error}` : ""}`;
}

function expectWait(run: Run, step: string): Run {
  if (run.status !== "waiting" || run.step !== step) throw new DemoSeedError(`Expected to wait at "${step}", but ${where(run)}.`);
  return run;
}

function expectDone(run: Run): Run {
  if (run.status !== "done") throw new DemoSeedError(`Expected the run to finish, but ${where(run)}.`);
  return run;
}

function orderIdOf(run: Run): string {
  const data = run.wait?.data as { orderId?: unknown } | undefined;
  const state = run.state as { orderId?: unknown };
  const id = typeof data?.orderId === "string" ? data.orderId : typeof state.orderId === "string" ? state.orderId : null;
  if (!id) throw new DemoSeedError(`No PayPal order to approve: ${where(run)}.`);
  return id;
}

/* ---------------------------------------------------------- the seven runs */

type Ctx = { rt: DemoRuntime; o: AppOrchestrator; mock: NonNullable<DemoRuntime["mockRail"]>; runs: DemoStoryRun[] };

async function approveAndResume(ctx: Ctx, run: Run, payer: string): Promise<Run> {
  const orderId = orderIdOf(run);
  ctx.mock.approveOrder(orderId, payer);
  return ctx.o.resume(run.id, { approved: true, orderId });
}

async function shopStory(ctx: Ctx): Promise<Run> {
  const { o } = ctx;
  let run = await o.start("shop", { redTeam: true, hireHelper: true, principal: BUYER });
  run = await o.resume(expectWait(run, "confirm_slip").id, { approved: true });
  run = await approveAndResume(ctx, expectWait(run, "complete_signing"), BUYER.email);
  run = await o.resume(expectWait(run, "confirm_cart").id, { approved: true, via: "click" });
  run = await o.resume(expectWait(run, "verify_delivery").id, { sample: true });
  ctx.runs.push({ pipeline: "shop", runId: run.id, role: "main", label: "Red-team listing, helper card, delivery check, refund" });
  return expectDone(run);
}

async function secondLookStory(ctx: Ctx): Promise<Run> {
  const flow = { orchestrator: ctx.o, mockRail: ctx.mock };
  const scam = await startToSeller(flow, fixtureInput("scam"));
  const refused = expectDone(await ctx.o.resume(scam.id, { response: "refused" }));
  const paid = expectDone(await protectedFlow(flow, fixtureInput("legit")));
  ctx.runs.push(
    { pipeline: "second-look", runId: paid.id, role: "main", label: "Protected goods payment, shipped with tracking" },
    { pipeline: "second-look", runId: refused.id, role: "support", label: "Scam chat: seller refused a protected payment" },
  );
  return paid;
}

async function bountyStory(ctx: Ctx): Promise<Run> {
  const { o, rt } = ctx;
  const created = await o.start("bounty", {
    kind: "bounty",
    title: "Shovel the walk at 12 Birch Lane",
    description: "Snow covers the front walk and steps at 12 Birch Lane. Mr. Alvarez is 82 and can't clear it himself.",
    reward: money("40.00"),
    deadline: new Date(rt.now().getTime() + 48 * HOUR).toISOString(),
    location: null,
    organizer: { name: "Priya Shah", email: "priya.shah@example.com" },
  });
  const bountyId = (created.state as BountyState).bountyId;
  if (created.status !== "waiting" || !bountyId) throw new DemoSeedError(`The bounty did not open: ${where(created)}.`);

  for (const [name, email, amount] of [
    ["Ann Lee", "ann.lee@example.com", "25.00"],
    ["Bo Chen", "bo.chen@example.com", "15.00"],
  ] as const) {
    const pledge = await o.start("bounty", { kind: "pledge", bountyId, backer: { name, email }, amount: money(amount) });
    const signed = expectDone(await approveAndResume(ctx, expectWait(pledge, "pledge_signed"), email));
    ctx.runs.push({ pipeline: "bounty", runId: signed.id, role: "support", label: `${name} pledged ${formatMoney(money(amount))}` });
    const board = o.get(created.id);
    if (board?.status === "waiting") await o.resume(created.id, { event: "pledge" });
  }

  let run = expectWait(o.get(created.id)!, "claim");
  run = await o.resume(run.id, { event: "claim", workerName: "Dana Ruiz", workerEmail: "dana.ruiz@example.com" });
  expectWait(run, "verify");
  const claimedAt = bounties(rt.store).get(bountyId)?.claim?.claimedAt;
  if (!claimedAt) throw new DemoSeedError("The bounty has no claim time.");
  const at = (ms: number) => new Date(Date.parse(claimedAt) + ms).toISOString();
  const photo = (name: (typeof SECOND_PASSING_PAIR)[number], capturedAt: string) => {
    const f = BOUNTY_PHOTOS[name];
    return { blobRef: rt.store.blobs.put({ contentType: f.contentType, base64: f.base64 }), capturedAt, dHash: f.dHash };
  };
  run = await o.resume(run.id, {
    event: "proof",
    before: photo(SECOND_PASSING_PAIR[0], at(1_000)),
    after: photo(SECOND_PASSING_PAIR[1], at(61_000)),
  });
  ctx.runs.push({ pipeline: "bounty", runId: run.id, role: "main", label: "Two pledges, a claim, fresh photos, payout to the worker" });
  return expectDone(run);
}

async function cashWeatherStory(ctx: Ctx): Promise<Run> {
  const { o } = ctx;
  let run = await o.start("cash-weather", { packageJson: DEFAULT_PACKAGE_JSON, importCounts: DEFAULT_IMPORT_COUNTS });
  if (run.status === "waiting" && run.step === "send_nudges") run = await o.resume(run.id, { approved: true });
  run = await o.resume(expectWait(run, "pay").id, { action: "sign" });
  ctx.runs.push({ pipeline: "cash-weather", runId: run.id, role: "main", label: "Forecast, reminders approved, patronage payout" });
  return expectDone(run);
}

async function tollRoadStory(ctx: Ctx): Promise<Run> {
  const { o } = ctx;
  let run = await o.start("toll-road", {});
  run = await o.resume(expectWait(run, "sign").id, { approved: true });
  run = await approveAndResume(ctx, expectWait(run, "activate"), "research.desk@example.com");
  ctx.runs.push({ pipeline: "toll-road", runId: run.id, role: "main", label: "HTTP 402 crawl, one capture, publisher payouts" });
  return expectDone(run);
}

async function disputeDeskStory(ctx: Ctx, captures: { shop: string; secondLook: string }): Promise<{ run: Run; disputeIds: string[] }> {
  const { o, rt } = ctx;
  const links: DemoLink[] = [
    { captureId: captures.secondLook, scenario: "not_received" },
    { captureId: captures.shop, scenario: "not_as_described" },
    { captureId: UNLINKED_CAPTURE, scenario: "unlinked" },
  ];
  await seedDemoDisputes(rt, links);
  const disputeIds = links.map(demoDisputeId);
  let run = await o.start("dispute-desk", { disputeId: disputeIds[0] });
  expectWait(run, "act");
  const s = run.state as unknown as DisputeDeskState;
  const decision = !s.recommendation || s.recommendation.decision === "need_more" ? "hold" : s.recommendation.decision;
  run = await o.resume(run.id, { decision, notes: decision === "hold" ? "" : (s.draft?.notes ?? "") });
  ctx.runs.push({ pipeline: "dispute-desk", runId: run.id, role: "main", label: "Not-received dispute answered from the slip's evidence" });
  return { run: expectDone(run), disputeIds };
}

async function paySmartStory(ctx: Ctx): Promise<Run> {
  const { o } = ctx;
  let run = await o.start("paysmart", { ask: PAYSMART_DEMO_ASK, principal: BUYER });
  expectWait(run, "choose");
  const pick = (run.state as unknown as PaySmartState).options.find((x) => x.id === "opt-1");
  if (!pick) throw new DemoSeedError(`PaySmart offered no opt-1 cart: ${where(run)}.`);
  run = await o.resume(run.id, { approved: true, optionId: pick.id, via: "click" });
  run = await approveAndResume(ctx, expectWait(run, "complete_signing"), BUYER.email);
  run = await o.resume(expectWait(run, "aftercare").id, { skip: true });
  ctx.runs.push({ pipeline: "paysmart", runId: run.id, role: "main", label: "Plain-words ask, three screened carts, one chosen and captured" });
  return expectDone(run);
}

function captureOf(run: Run, rt: DemoRuntime): string {
  const fromState = (run.state as { captureId?: unknown }).captureId;
  if (typeof fromState === "string" && fromState) return fromState;
  const slip = run.slipId ? rt.store.slips.get(run.slipId) : null;
  const id = slip?.rail.captureIds[0];
  if (!id) throw new DemoSeedError(`${run.pipeline} run ${run.id} has no capture to dispute.`);
  return id;
}

/**
 * Adds the labelled demo affiliate account for the sample shops when none exists, so the offline
 * demo shows tagged links. Mock rail only: a sandbox runtime never gets it. Seeding twice adds nothing.
 */
export function seedDemoAffiliate(rt: Pick<DemoRuntime, "rail" | "store">): AffiliateAccount | null {
  if (rt.rail.mode !== "mock") return null;
  const repo = affiliateRepo(rt.store);
  if (repo.list().length > 0) return null;
  return repo.create({
    network: "generic",
    label: "Demo affiliate (sample shops)",
    trackingId: "permission-slip-demo",
    domains: ["dinodepot.example", "toyburrow.example", "figurefarm.example", "pagepond.example"],
    params: { ref: "{id}" },
    commissionBps: 400,
  });
}

/** Runs the whole story. Writes the story record as it goes; throws DemoSeedError on a bad turn. */
export async function seedDemoStory(rt: DemoRuntime): Promise<DemoStoryDoc> {
  const mock = mockControls(rt);
  const col = demoStories(rt.store);
  const ctx: Ctx = { rt, o: seedOrchestrator(rt), mock, runs: [] };
  let doc: DemoStoryDoc = {
    version: 1,
    status: "seeding",
    startedAt: rt.now().toISOString(),
    finishedAt: null,
    error: null,
    runs: [],
    disputeIds: [],
    disputes: [],
  };
  col.put(DEMO_STORY_KEY, doc);
  try {
    seedDemoAffiliate(rt); // before the shop run, so its links carry the demo ID
    const shop = await shopStory(ctx); // first, so its OUTSIDE verdict leads the ledger
    const secondLook = await secondLookStory(ctx);
    await bountyStory(ctx);
    await cashWeatherStory(ctx);
    await tollRoadStory(ctx);
    const { disputeIds } = await disputeDeskStory(ctx, { shop: captureOf(shop, rt), secondLook: captureOf(secondLook, rt) });
    await paySmartStory(ctx);
    const disputes = (await rt.rail.listDisputes()).filter((d) => disputeIds.includes(d.id));
    doc = { ...doc, status: "loaded", finishedAt: rt.now().toISOString(), runs: ctx.runs, disputeIds, disputes };
  } catch (e) {
    doc = { ...doc, status: "failed", finishedAt: rt.now().toISOString(), error: e instanceof Error ? e.message : String(e), runs: ctx.runs };
    col.put(DEMO_STORY_KEY, doc);
    throw e;
  }
  col.put(DEMO_STORY_KEY, doc);
  return doc;
}

/* ------------------------------------------------------------- idempotency */

export interface DemoLoadResult {
  status: "loaded" | "already_loaded";
  message: string;
  doc: DemoStoryDoc;
  rows: DemoRow[];
  ok: boolean;
}

const LOCK = "__permissionSlipDemoSeed";

/**
 * Seeds the story once. A second call returns "already_loaded" without adding data; it only puts
 * back demo disputes the mock rail lost in a restart. Concurrent calls share one seeding.
 */
export async function loadDemoStory(rt: DemoRuntime): Promise<DemoLoadResult> {
  mockControls(rt);
  const g = globalThis as typeof globalThis & { [LOCK]?: Promise<DemoLoadResult> };
  if (g[LOCK]) return g[LOCK];
  const work = (async (): Promise<DemoLoadResult> => {
    const existing = readDemoStory(rt.store);
    if (existing && existing.status === "loaded") {
      const present = (await rt.rail.listDisputes()).map((d) => d.id);
      const restored = restoreDemoDisputes(rt.store, rt.mockRail, present);
      const rows = demoRows(rt, existing);
      return {
        status: "already_loaded",
        message: `The demo story is already loaded (since ${existing.finishedAt ?? existing.startedAt}). Nothing was added${restored ? `; ${restored} demo dispute${restored === 1 ? "" : "s"} put back on the mock rail` : ""}.`,
        doc: existing,
        rows,
        ok: rowsOk(rows, existing, rt),
      };
    }
    const doc = await seedDemoStory(rt);
    const rows = demoRows(rt, doc);
    const ok = rowsOk(rows, doc, rt);
    return {
      status: "loaded",
      message: ok ? `Loaded the demo story: ${rows.length} pipelines ran to the end and every ledger chain verifies.` : "The demo story loaded, but a run or a chain needs a look.",
      doc,
      rows,
      ok,
    };
  })();
  g[LOCK] = work;
  try {
    return await work;
  } finally {
    delete g[LOCK];
  }
}

/* ------------------------------------------------------------------- table */

export interface DemoRow {
  pipeline: PipelineId;
  label: string;
  runId: string;
  slipId: string | null;
  runStatus: RunStatus | "missing";
  slipStatus: SlipStatus | "none";
  outcome: string | null;
  money: MoneyFigures;
  chainOk: boolean;
  slipsChecked: number;
}

function outcomeOf(run: Run, rt: DemoRuntime): string | null {
  const s = run.state as Record<string, unknown>;
  if (run.pipeline === "bounty" && typeof s.bountyId === "string") return bounties(rt.store).get(s.bountyId)?.status ?? null;
  const o = s.outcome;
  if (typeof o === "string") return o;
  if (o && typeof o === "object" && typeof (o as { kind?: unknown }).kind === "string") return (o as { kind: string }).kind;
  return null;
}

/** Slips whose ledgers belong to a row: [money slips, chain slips]. */
function slipsOf(run: Run, rt: DemoRuntime): { money: string[]; chain: string[] } {
  const own = run.slipId ? [run.slipId] : [];
  const s = run.state as Record<string, unknown>;
  switch (run.pipeline) {
    case "shop": {
      const kids = run.slipId ? rt.store.slips.list({ parentId: run.slipId }).map((c) => c.id) : [];
      return { money: [...own, ...kids], chain: [...own, ...kids] };
    }
    case "bounty": {
      const pledges = rt.store.slips
        .list({ pipeline: "bounty" })
        .filter((x: Slip) => x.meta.role === "pledge" && x.meta.bountyId === s.bountyId)
        .map((x) => x.id);
      return { money: [...own, ...pledges], chain: [...own, ...pledges] };
    }
    case "toll-road": {
      const network = typeof s.networkSlipId === "string" ? [s.networkSlipId] : [];
      return { money: [...own, ...network], chain: [...own, ...network] };
    }
    case "dispute-desk":
      // Dispute Desk moves no money: it answers on the linked slip's ledger.
      return { money: [], chain: own };
    default:
      return { money: own, chain: own };
  }
}

export function demoRows(rt: DemoRuntime, doc: DemoStoryDoc): DemoRow[] {
  return doc.runs
    .filter((r) => r.role === "main")
    .map((r): DemoRow => {
      const run = rt.orchestrator.get(r.runId);
      if (!run) {
        return {
          pipeline: r.pipeline,
          label: r.label,
          runId: r.runId,
          slipId: null,
          runStatus: "missing",
          slipStatus: "none",
          outcome: null,
          money: moneyFigures(rt.store, []),
          chainOk: false,
          slipsChecked: 0,
        };
      }
      const slip = run.slipId ? rt.store.slips.get(run.slipId) : null;
      const ids = slipsOf(run, rt);
      const chain = chainFigures(rt.store, ids.chain);
      return {
        pipeline: r.pipeline,
        label: r.label,
        runId: run.id,
        slipId: run.slipId,
        runStatus: run.status,
        slipStatus: slip?.status ?? "none",
        outcome: outcomeOf(run, rt),
        money: moneyFigures(rt.store, ids.money),
        chainOk: chain.ok && chain.slips > 0,
        slipsChecked: chain.slips,
      };
    });
}

/** Every run in the story (main and support) finished, and every row's chain verifies. */
export function rowsOk(rows: DemoRow[], doc: DemoStoryDoc, rt?: DemoRuntime): boolean {
  if (doc.status !== "loaded" || rows.length === 0) return false;
  if (rows.some((r) => r.runStatus !== "done" || !r.chainOk)) return false;
  if (rt && doc.runs.some((r) => rt.orchestrator.get(r.runId)?.status !== "done")) return false;
  return true;
}

export function formatDemoTable(rows: DemoRow[]): string {
  const head = ["pipeline", "run", "slip", "run status", "slip status", "held", "captured", "released", "paid out", "refunded", "chain verified", "outcome"];
  const body = rows.map((r) => [
    r.pipeline,
    r.runId,
    r.slipId ?? "-",
    r.runStatus,
    r.slipStatus,
    formatMoney(r.money.held),
    formatMoney(r.money.captured),
    formatMoney(r.money.released),
    formatMoney(r.money.paidOut),
    formatMoney(r.money.refunded),
    r.chainOk ? `yes (${r.slipsChecked})` : "NO",
    r.outcome ?? "-",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const money = new Set([5, 6, 7, 8, 9]);
  const line = (cells: string[]) => cells.map((c, i) => (money.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

/* ------------------------------------------------------------------- HTTP */

/**
 * POST /api/demo/seed. 404 unless the PayPal rail is the mock (so a sandbox deploy never shows it),
 * 409 when the AI is not the scripted mock, otherwise the load result. Safe to call twice.
 */
export async function demoSeedResponse(getRt: () => DemoRuntime, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (resolveConfig(env).paypalMode !== "mock") return Response.json({ error: "Not found" }, { status: 404 });
  const rt = getRt();
  if (rt.rail.mode !== "mock") return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const result = await loadDemoStory(rt);
    return Response.json(
      {
        status: result.status,
        ok: result.ok,
        message: result.message,
        rows: result.rows,
        disputeIds: result.doc.disputeIds,
        seededAt: result.doc.finishedAt,
      },
      { status: result.ok ? 200 : 500 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: e instanceof DemoSeedError ? 409 : 500 });
  }
}
