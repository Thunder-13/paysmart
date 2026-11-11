/**
 * Deterministic proof checks. Pure functions, no I/O: they run before any AI call, and when one
 * fails the vision model never sees the photos.
 */
import { hamming, NEAR_DUPLICATE_BITS } from "./dhash";
import { CLOCK_SKEW_MS, type CheckResult, type JobSite, type ProofRow } from "./schema";

export interface CheckedPhoto {
  role: "before" | "after";
  dHash: string;
  sha256: string;
  capturedAt: string;
  lat?: number;
  lng?: number;
}

export const FRESH_CHECK = { id: "fresh_photos", label: "Fresh photos, never used before" } as const;
export const TIMING_CHECK = { id: "timing", label: "Taken after the claim and before the deadline" } as const;
export const LOCATION_CHECK = { id: "location", label: "Taken at the job site" } as const;

/**
 * Fails when before and after match each other, or either matches any stored photo from any
 * bounty. A match is a dHash within NEAR_DUPLICATE_BITS or the same SHA-256.
 */
export function freshPhotos(photos: [CheckedPhoto, CheckedPhoto], stored: Pick<ProofRow, "bountyId" | "bountyTitle" | "dHash" | "sha256" | "role">[]): CheckResult {
  const [before, after] = photos;
  const pairBits = hamming(before.dHash, after.dHash);
  if (before.sha256 === after.sha256 || pairBits <= NEAR_DUPLICATE_BITS) {
    return {
      ...FRESH_CHECK,
      status: "fail",
      detail: `The before and after photos are the same picture (${before.sha256 === after.sha256 ? "identical bytes" : `${pairBits} of 64 bits apart`}).`,
    };
  }
  let closest = 64;
  for (const photo of photos) {
    for (const row of stored) {
      const bits = hamming(photo.dHash, row.dHash);
      closest = Math.min(closest, bits);
      if (row.sha256 === photo.sha256 || bits <= NEAR_DUPLICATE_BITS) {
        const how = row.sha256 === photo.sha256 ? "identical bytes" : `${bits} of 64 bits apart`;
        return {
          ...FRESH_CHECK,
          status: "fail",
          detail: `The ${photo.role} photo matches a ${row.role} photo already sent for bounty "${row.bountyTitle}" (${row.bountyId}), ${how}.`,
        };
      }
    }
  }
  return {
    ...FRESH_CHECK,
    status: "pass",
    detail:
      stored.length === 0
        ? `Before and after are ${pairBits} bits apart; no earlier photos to compare.`
        : `Before and after are ${pairBits} bits apart; the closest of ${stored.length} earlier photos is ${closest} bits away.`,
  };
}

/** Both capture times inside (claimedAt, deadline), before < after, neither ahead of now + skew. */
export function timing(photos: [CheckedPhoto, CheckedPhoto], claimedAt: string, deadline: string, now: Date): CheckResult {
  const [before, after] = photos;
  const b = Date.parse(before.capturedAt);
  const a = Date.parse(after.capturedAt);
  const claim = Date.parse(claimedAt);
  const end = Date.parse(deadline);
  const fail = (detail: string): CheckResult => ({ ...TIMING_CHECK, status: "fail", detail });
  if (Number.isNaN(b) || Number.isNaN(a)) return fail("A capture time could not be read.");
  for (const [role, at] of [
    ["before", b],
    ["after", a],
  ] as const) {
    if (at > now.getTime() + CLOCK_SKEW_MS) return fail(`The ${role} photo claims a time in the future (${new Date(at).toISOString()}).`);
    if (at <= claim) return fail(`The ${role} photo was taken before the job was claimed.`);
    if (at >= end) return fail(`The ${role} photo was taken after the deadline.`);
  }
  if (b >= a) return fail("The before photo was taken after the after photo.");
  const minutes = Math.round((a - b) / 60_000);
  return { ...TIMING_CHECK, status: "pass", detail: `Both taken after the claim, ${minutes} min apart, before the deadline.` };
}

/** Great-circle distance in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function showDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** No site: skipped. Photo without coordinates: not checked (does not fail). Outside radius: fail. */
export function location(photos: [CheckedPhoto, CheckedPhoto], site: JobSite | null): CheckResult {
  if (!site) return { ...LOCATION_CHECK, status: "skipped", detail: "This bounty has no job site pinned." };
  const notes: string[] = [];
  let checked = 0;
  for (const photo of photos) {
    if (typeof photo.lat !== "number" || typeof photo.lng !== "number") {
      notes.push(`${photo.role}: not checked, no location on the photo`);
      continue;
    }
    checked += 1;
    const d = haversineMeters(site.lat, site.lng, photo.lat, photo.lng);
    if (d > site.radiusM) {
      return {
        ...LOCATION_CHECK,
        status: "fail",
        detail: `The ${photo.role} photo was taken ${showDistance(d)} from the job site; the limit is ${showDistance(site.radiusM)}.`,
      };
    }
    notes.push(`${photo.role}: ${showDistance(d)} from the site`);
  }
  return {
    ...LOCATION_CHECK,
    status: checked === 0 ? "skipped" : "pass",
    detail: checked === 0 ? "Not checked: neither photo carries a location." : `Within ${showDistance(site.radiusM)} (${notes.join("; ")}).`,
  };
}
