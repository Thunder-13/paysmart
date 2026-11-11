import { connection, type NextRequest } from "next/server";
import type { LedgerEvent } from "@/core/contracts";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

/**
 * GET /api/events?slipId=... -> text/event-stream of LedgerEvent JSON (unnamed "message" events).
 * Replays the slip's chain (or the 50 most recent events without slipId), then streams live.
 * Honors Last-Event-ID (the seq) on reconnect for a slip stream.
 */
export async function GET(request: NextRequest) {
  await connection();
  const slipId = request.nextUrl.searchParams.get("slipId");
  const lastId = Number(request.headers.get("last-event-id") ?? "");
  const { store } = getRuntime();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const sendEvent = (e: LedgerEvent) => {
        const id = slipId ? String(e.seq) : `${e.slipId}:${e.seq}`;
        send(`id: ${id}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      send("retry: 3000\n\n");
      const replay = slipId ? store.ledger.list(slipId) : store.ledger.listRecent(50).reverse();
      for (const e of replay) {
        if (slipId && Number.isFinite(lastId) && lastId > 0 && e.seq <= lastId) continue;
        sendEvent(e);
      }
      const unsubscribe = store.ledger.subscribe((e) => {
        if (!slipId || e.slipId === slipId) sendEvent(e);
      });
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
