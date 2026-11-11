/**
 * Browser-side ledger verification with Web Crypto. Mirrors ledgerHash and verifyChain in the
 * server store, but imports nothing from node, so a client component can re-check a real chain.
 */
import { canonicalJson, GENESIS } from "./canonical-json";

export interface WebLedgerEvent {
  seq: number;
  slipId: string;
  type: string;
  actor: string;
  at: string;
  data: unknown;
  prevHash: string;
  hash: string;
}

export type LinkStatus = "ok" | "hash-mismatch" | "link-broken";

export interface WebLinkResult {
  seq: number;
  status: LinkStatus;
  /** Hash recomputed from the event's own fields and the previous stored hash. */
  recomputed: string;
}

export interface WebChainResult {
  links: WebLinkResult[];
  ok: boolean;
  brokenAtSeq: number | null;
}

export function webCryptoAvailable(): boolean {
  return typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.subtle?.digest === "function";
}

export async function sha256HexWeb(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, "0");
  return out;
}

export function ledgerHashWeb(
  prevHash: string,
  event: Pick<WebLedgerEvent, "seq" | "slipId" | "type" | "actor" | "at" | "data">,
): Promise<string> {
  return sha256HexWeb(
    prevHash +
      canonicalJson({
        seq: event.seq,
        slipId: event.slipId,
        type: event.type,
        actor: event.actor,
        at: event.at,
        data: event.data,
      }),
  );
}

/**
 * Re-checks every link. Each event is hashed against the previous event's STORED hash, so one
 * edit breaks its own hash and the next event's link, and every event after it is marked failed.
 */
export async function verifyChainWeb(events: readonly WebLedgerEvent[]): Promise<WebChainResult> {
  const links: WebLinkResult[] = [];
  let prevStored = GENESIS;
  let failed = false;
  let brokenAtSeq: number | null = null;
  for (const e of events) {
    const recomputed = await ledgerHashWeb(prevStored, e);
    let status: LinkStatus = "ok";
    if (failed || e.prevHash !== prevStored) status = "link-broken";
    else if (recomputed !== e.hash) status = "hash-mismatch";
    if (status !== "ok") {
      failed = true;
      if (brokenAtSeq === null) brokenAtSeq = e.seq;
    }
    links.push({ seq: e.seq, status, recomputed });
    prevStored = e.hash;
  }
  return { links, ok: !failed, brokenAtSeq };
}
