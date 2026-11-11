/** Calendar-day helpers. Days are UTC, counted as integers since 1970-01-01. */
const DAY_MS = 86_400_000;

/** UTC day number for an ISO date ("2026-11-09") or datetime ("2026-11-09T14:00:00Z"). */
export function dayOf(iso: string): number {
  const day = iso.slice(0, 10);
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(t)) throw new Error(`Not an ISO date: "${iso}"`);
  return Math.floor(t / DAY_MS);
}

export function isoOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** UTC calendar date of a clock reading, as "YYYY-MM-DD". */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return isoOfDay(dayOf(iso) + days);
}

/** "Nov 9" in UTC, stable across server and browser. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
