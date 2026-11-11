/** Small helpers shared by the API route handlers. */
import { RunInputError, RunStateError } from "@/core/orchestrator";
import type { Run, Slip } from "@/core/contracts";

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Maps known error classes to HTTP statuses; everything else is a 500 with the message. */
export function errorResponse(e: unknown): Response {
  if (e instanceof RunInputError) return jsonError(400, e.message);
  if (e instanceof RunStateError) return jsonError(/not found/.test(e.message) ? 404 : 409, e.message);
  return jsonError(500, e instanceof Error ? e.message : String(e));
}

/** Keeps a background promise from surfacing as an unhandled rejection. */
export function settle(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    (e: unknown) => {
      console.error("[permission-slip] background run error", e);
    },
  );
}

/** Append run=<id> to a same-site path, keeping its query string and hash. */
export function withRunParam(returnPath: string, runId: string | null): string {
  const safe = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
  if (!runId) return safe;
  const hashAt = safe.indexOf("#");
  const base = hashAt >= 0 ? safe.slice(0, hashAt) : safe;
  const hash = hashAt >= 0 ? safe.slice(hashAt) : "";
  return `${base}${base.includes("?") ? "&" : "?"}run=${encodeURIComponent(runId)}${hash}`;
}

/** The waiting run for a slip (PayPal approval), else the newest run that touched it. */
export function runForSlip(runs: Run[], slipId: string): { waiting: Run | null; latest: Run | null } {
  const mine = runs.filter((r) => r.slipId === slipId);
  return { waiting: mine.find((r) => r.status === "waiting") ?? null, latest: mine[0] ?? null };
}

export function returnPathOf(slip: Slip | null): string {
  const p = slip?.meta.returnPath;
  return typeof p === "string" && p !== "" ? p : "/";
}
