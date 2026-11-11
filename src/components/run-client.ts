"use client";
/**
 * Browser helpers for runs.
 *   startRun / resumeRun  POST and return the 202 Run snapshot (execution continues on the server)
 *   useRun(runId)         {run, slip, events, error, refresh}; polls /api/runs/[id] every 1.5 s while the
 *                         run is running or waiting, and streams the run slip's chain over SSE
 *   useSlipEvents(slipId) live ledger events for any slip (e.g. a child slip)
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LedgerEvent, PipelineId, Run, Slip } from "@/core/contracts";

export const POLL_MS = 1500;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

export function startRun(pipeline: PipelineId, input: unknown): Promise<Run> {
  return fetchJson<Run>("/api/runs", { method: "POST", body: JSON.stringify({ pipeline, input }) });
}

export function resumeRun(runId: string, signal: unknown): Promise<Run> {
  return fetchJson<Run>(`/api/runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: JSON.stringify({ signal }) });
}

export function mergeEvents(a: LedgerEvent[], b: LedgerEvent[]): LedgerEvent[] {
  const bySeq = new Map<string, LedgerEvent>();
  for (const e of [...a, ...b]) bySeq.set(`${e.slipId}:${e.seq}`, e);
  return [...bySeq.values()].sort((x, y) => (x.slipId === y.slipId ? x.seq - y.seq : x.at.localeCompare(y.at)));
}

export interface SlipStreamState {
  events: LedgerEvent[];
  connected: boolean;
}

const EMPTY_STREAM: SlipStreamState = { events: [], connected: false };

interface SlipEntry {
  state: SlipStreamState;
  listeners: Set<() => void>;
  source: EventSource | null;
}

/** One entry per slip with at least one subscriber. The first subscriber opens the EventSource, the last closes it. */
const registry = new Map<string, SlipEntry>();

function openEntry(slipId: string, entry: SlipEntry): void {
  if (typeof EventSource === "undefined") return;
  const set = (state: SlipStreamState) => {
    entry.state = state;
    for (const l of [...entry.listeners]) l();
  };
  const source = new EventSource(`/api/events?slipId=${encodeURIComponent(slipId)}`);
  entry.source = source;
  source.onopen = () => set({ ...entry.state, connected: true });
  source.onerror = () => {
    if (entry.state.connected) set({ ...entry.state, connected: false });
  };
  source.onmessage = (msg: MessageEvent<string>) => {
    let event: LedgerEvent;
    try {
      event = JSON.parse(msg.data) as LedgerEvent;
    } catch {
      return;
    }
    if (event.slipId !== slipId) return;
    if (entry.state.events.some((e) => e.seq === event.seq)) return;
    set({ ...entry.state, events: mergeEvents(entry.state.events, [event]) });
  };
}

/** Subscribe to a slip's shared stream. Returns the unsubscribe function. */
export function subscribeSlip(slipId: string, listener: () => void): () => void {
  let entry = registry.get(slipId);
  if (!entry) {
    entry = { state: EMPTY_STREAM, listeners: new Set(), source: null };
    registry.set(slipId, entry);
    entry.listeners.add(listener);
    openEntry(slipId, entry);
  } else {
    entry.listeners.add(listener);
  }
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.source?.close();
      current.source = null;
      if (registry.get(slipId) === current) registry.delete(slipId);
    }
  };
}

/** Current snapshot for a slip (stable reference until the stream changes). */
export function getSlipSnapshot(slipId: string): SlipStreamState {
  return registry.get(slipId)?.state ?? EMPTY_STREAM;
}

const serverSnapshot = (): SlipStreamState => EMPTY_STREAM;
const noopSubscribe = () => () => {};
const emptySnapshot = (): SlipStreamState => EMPTY_STREAM;

/** Live ledger events for one slip over SSE (replays the chain first). One EventSource per slip, shared by every caller. */
export function useSlipEvents(slipId: string | null): { events: LedgerEvent[]; connected: boolean } {
  const subscribe = useMemo(() => (slipId ? (l: () => void) => subscribeSlip(slipId, l) : noopSubscribe), [slipId]);
  const getSnapshot = useMemo(() => (slipId ? () => getSlipSnapshot(slipId) : emptySnapshot), [slipId]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

interface RunSnapshot {
  run: Run;
  slip: Slip | null;
  events: LedgerEvent[];
}

export interface UseRunResult {
  run: Run | null;
  slip: Slip | null;
  /** The run slip's chain only (polled + live). Child slips: useSlipEvents(childId). */
  events: LedgerEvent[];
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRun(runId: string | null): UseRunResult {
  const [snap, setSnap] = useState<{ runId: string | null; data: RunSnapshot | null; error: string | null }>({
    runId: null,
    data: null,
    error: null,
  });

  const load = useCallback(async (id: string): Promise<RunSnapshot | null> => {
    try {
      const data = await fetchJson<RunSnapshot>(`/api/runs/${encodeURIComponent(id)}`);
      setSnap({ runId: id, data, error: null });
      return data;
    } catch (e) {
      setSnap((s) => ({ runId: id, data: s.runId === id ? s.data : null, error: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const data = await load(runId);
      if (cancelled) return;
      const status = data?.run.status;
      if (!data || status === "running" || status === "waiting") {
        timer = setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, load]);

  const current = snap.runId === runId ? snap : { runId, data: null, error: null };
  const slipId = current.data?.run.slipId ?? null;
  const live = useSlipEvents(slipId);

  const events = useMemo(() => {
    const polled = current.data?.events ?? [];
    return slipId ? mergeEvents(polled, live.events).filter((e) => e.slipId === slipId) : polled;
  }, [current.data, live.events, slipId]);

  const refresh = useCallback(async () => {
    if (runId) await load(runId);
  }, [runId, load]);

  return {
    run: current.data?.run ?? null,
    slip: current.data?.slip ?? null,
    events,
    error: current.error,
    refresh,
  };
}
