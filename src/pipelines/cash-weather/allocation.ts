/**
 * Upstream allocation. Each direct dependency weighs 1, plus up to 1 more in proportion to its
 * import count (capped at 20). A package's weight is split evenly among its maintainers who have a
 * receiver in the configured mapping; packages with none get no PayPal route. Weights become
 * integer basis points that sum to exactly 10000 (largest remainder, ties by handle).
 */
import { z } from "zod";
import type { PackageMeta, PackageRow, ReceiverRow } from "./types";
import { RECEIVERS_FIXTURE } from "./fixtures";
import { isValidHandle } from "./registry";

export const IMPORT_CAP = 20;

export function packageWeight(importCount: number | null | undefined): number {
  if (importCount === null || importCount === undefined) return 1;
  return 1 + Math.min(Math.max(importCount, 0), IMPORT_CAP) / IMPORT_CAP;
}

/** Largest-remainder rounding of non-negative weights to integers that sum to `total`. */
export function largestRemainder<K extends string>(weights: { key: K; weight: number }[], total: number): Map<K, number> {
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  const out = new Map<K, number>();
  if (weights.length === 0 || sum <= 0) return out;
  const rows = weights.map((w) => {
    const exact = (w.weight / sum) * total;
    const floor = Math.floor(exact + 1e-9);
    return { key: w.key, floor, rest: exact - floor };
  });
  let left = total - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.rest - a.rest || a.key.localeCompare(b.key));
  for (const r of order) {
    if (left <= 0) break;
    r.floor += 1;
    left -= 1;
  }
  for (const r of rows) out.set(r.key, r.floor);
  return out;
}

const ReceiverMapSchema = z.record(z.string(), z.email());

/** Fixture mapping, with CASH_WEATHER_RECEIVERS_JSON merged over it. Bad env JSON is ignored. */
export function receiverMap(envJson: string | undefined): { map: Record<string, string>; problem: string | null } {
  const map: Record<string, string> = {};
  const add = (entries: Record<string, string>) => {
    for (const [handle, email] of Object.entries(entries)) {
      const h = handle.trim().toLowerCase();
      if (isValidHandle(h)) map[h] = email.trim();
    }
  };
  add(ReceiverMapSchema.parse(RECEIVERS_FIXTURE));
  if (!envJson || envJson.trim() === "") return { map, problem: null };
  try {
    const parsed = ReceiverMapSchema.safeParse(JSON.parse(envJson));
    if (!parsed.success) return { map, problem: "CASH_WEATHER_RECEIVERS_JSON must map npm handles to emails; using the bundled mapping" };
    add(parsed.data);
    return { map, problem: null };
  } catch {
    return { map, problem: "CASH_WEATHER_RECEIVERS_JSON is not valid JSON; using the bundled mapping" };
  }
}

export function allocate(
  metas: PackageMeta[],
  receivers: Record<string, string>,
  importCounts?: Record<string, number>,
): { packages: PackageRow[]; receivers: ReceiverRow[] } {
  const perHandle = new Map<string, { weight: number; packages: string[] }>();
  const packages: PackageRow[] = metas.map((m) => {
    const importCount = importCounts && Object.prototype.hasOwnProperty.call(importCounts, m.name) ? importCounts[m.name] : null;
    const weight = packageWeight(importCount);
    const mapped = m.maintainers.filter((h) => Object.prototype.hasOwnProperty.call(receivers, h));
    for (const h of mapped) {
      const row = perHandle.get(h) ?? { weight: 0, packages: [] };
      row.weight += weight / mapped.length;
      row.packages.push(m.name);
      perHandle.set(h, row);
    }
    return { ...m, weight, importCount, mapped, route: mapped.length > 0 };
  });
  const bps = largestRemainder(
    [...perHandle].map(([key, v]) => ({ key, weight: v.weight })),
    10000,
  );
  const rows: ReceiverRow[] = [...perHandle]
    .map(([handle, v]) => ({ handle, email: receivers[handle], weightBps: bps.get(handle) ?? 0, packages: v.packages }))
    .sort((a, b) => b.weightBps - a.weightBps || a.handle.localeCompare(b.handle));
  return { packages, receivers: rows };
}
