/**
 * npm registry metadata: maintainer handles and the funding field for each dependency.
 * Live mode reads https://registry.npmjs.org/<name>/latest (a few KB; the full packument at
 * /<name> carries the same fields but can run to megabytes). Fixtures cover mock mode and every
 * live failure. Registry data is untrusted: only handles and an https funding link survive, and
 * maintainer emails are dropped here so they can never become payout receivers.
 */
import { z } from "zod";
import type { PackageMeta } from "./types";

export const REGISTRY_BASE = "https://registry.npmjs.org";
export const REGISTRY_TIMEOUT_MS = 3000;
export const REGISTRY_CONCURRENCY = 4;
const MAX_MAINTAINERS = 10;

/** npm package name rules: lowercase, optional @scope/, no path segments or URL characters. */
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,213}$/;

export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NAME_RE.test(name);
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

export function registryUrl(name: string): string {
  if (!isValidPackageName(name)) throw new Error(`Refusing to build a registry URL for "${name}"`);
  return `${REGISTRY_BASE}/${name.replace("/", "%2f")}/latest`;
}

const FundingEntry = z.union([z.string(), z.looseObject({ url: z.string() })]);
export const RegistryDocSchema = z.looseObject({
  name: z.string(),
  version: z.string().optional(),
  maintainers: z.array(z.looseObject({ name: z.string() })).optional(),
  funding: z.union([FundingEntry, z.array(FundingEntry)]).nullable().optional(),
});

/** First https funding URL, or null. Anything else is dropped. */
export function fundingUrl(funding: unknown): string | null {
  const entries = Array.isArray(funding) ? funding : funding === undefined || funding === null ? [] : [funding];
  for (const e of entries) {
    const raw = typeof e === "string" ? e : e && typeof e === "object" && typeof (e as { url?: unknown }).url === "string" ? (e as { url: string }).url : null;
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // not a URL
    }
  }
  return null;
}

/** Validates a registry (or fixture) document and keeps only what the pipeline may use. */
export function normalizeDoc(name: string, raw: unknown, source: PackageMeta["source"], offline: boolean): PackageMeta {
  const parsed = RegistryDocSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Registry data for ${name} failed validation`);
  const maintainers = [...new Set((parsed.data.maintainers ?? []).map((m) => m.name.trim().toLowerCase()).filter(isValidHandle))]
    .slice(0, MAX_MAINTAINERS)
    .sort();
  return {
    name,
    version: parsed.data.version ?? null,
    maintainers,
    funding: fundingUrl(parsed.data.funding),
    source,
    offline,
    error: null,
  };
}

function fromFixture(name: string, fixtures: Record<string, unknown>, offline: boolean, error: string | null): PackageMeta {
  const doc = fixtures[name];
  if (doc !== undefined) {
    try {
      return { ...normalizeDoc(name, doc, "fixture", offline), error };
    } catch {
      // fall through to unknown
    }
  }
  return { name, version: null, maintainers: [], funding: null, source: "unknown", offline, error: error ?? "No fixture for this package" };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface RegistryOptions {
  mode: "live" | "fixtures";
  fixtures: Record<string, unknown>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  concurrency?: number;
}

async function fetchOne(name: string, opts: RegistryOptions): Promise<PackageMeta> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const res = await fetchImpl(registryUrl(name), {
      signal: AbortSignal.timeout(opts.timeoutMs ?? REGISTRY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    return normalizeDoc(name, await res.json(), "registry", false);
  } catch (e) {
    const reason = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e);
    return fromFixture(name, opts.fixtures, true, `Live registry read failed (${reason}); using offline data`);
  }
}

/** Metadata for each name, in input order. Fixtures mode never touches the network. */
export async function fetchPackageMeta(names: string[], opts: RegistryOptions): Promise<PackageMeta[]> {
  if (opts.mode === "fixtures") return names.map((n) => fromFixture(n, opts.fixtures, false, null));
  const out: PackageMeta[] = new Array(names.length);
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const i = next++;
      out[i] = await fetchOne(names[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? REGISTRY_CONCURRENCY, names.length) }, worker));
  return out;
}
