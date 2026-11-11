import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LedgerEvent } from "@/core/contracts";
import { getSlipSnapshot, subscribeSlip } from "./run-client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  push(e: Partial<LedgerEvent>) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}

const ev = (slipId: string, seq: number): Partial<LedgerEvent> => ({ slipId, seq, at: `2026-01-01T00:00:0${seq}Z` });
const g = globalThis as unknown as { EventSource?: unknown };
let original: unknown;

beforeEach(() => {
  original = g.EventSource;
  FakeEventSource.instances = [];
  g.EventSource = FakeEventSource;
});
afterEach(() => {
  g.EventSource = original;
});

describe("subscribeSlip registry", () => {
  it("shares one EventSource between two subscribers and closes after both leave", () => {
    let a = 0;
    let b = 0;
    const offA = subscribeSlip("s1", () => a++);
    const offB = subscribeSlip("s1", () => b++);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events?slipId=s1");
    FakeEventSource.instances[0].push(ev("s1", 1));
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(getSlipSnapshot("s1").events).toHaveLength(1);
    offA();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    offB();
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(getSlipSnapshot("s1").events).toHaveLength(0);
  });

  it("gives a late subscriber the events gathered so far, deduped by seq", () => {
    const off1 = subscribeSlip("s2", () => {});
    const src = FakeEventSource.instances[0];
    src.push(ev("s2", 1));
    src.push(ev("s2", 2));
    src.push(ev("s2", 2));
    const off2 = subscribeSlip("s2", () => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(getSlipSnapshot("s2").events.map((e) => e.seq)).toEqual([1, 2]);
    off1();
    off2();
  });

  it("opens a separate source per slipId and tracks connected", () => {
    const offA = subscribeSlip("s3", () => {});
    const offB = subscribeSlip("s4", () => {});
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[0].onopen?.();
    expect(getSlipSnapshot("s3").connected).toBe(true);
    expect(getSlipSnapshot("s4").connected).toBe(false);
    offA();
    expect(FakeEventSource.instances[1].closed).toBe(false);
    offB();
  });
});
