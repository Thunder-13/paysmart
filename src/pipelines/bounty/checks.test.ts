import { describe, expect, it } from "vitest";
import { freshPhotos, haversineMeters, location, timing, type CheckedPhoto } from "./checks";

const CLAIM = "2026-11-10T12:00:00.000Z";
const DEADLINE = "2026-11-12T12:00:00.000Z";
const NOW = new Date("2026-11-10T13:00:00.000Z");

function pair(over: { before?: Partial<CheckedPhoto>; after?: Partial<CheckedPhoto> } = {}): [CheckedPhoto, CheckedPhoto] {
  return [
    { role: "before", dHash: "0000000000000000", sha256: "aa", capturedAt: "2026-11-10T12:10:00.000Z", ...over.before },
    { role: "after", dHash: "00000000ffffffff", sha256: "bb", capturedAt: "2026-11-10T12:40:00.000Z", ...over.after },
  ];
}

const stored = (dHash: string, sha256 = "zz") => ({ bountyId: "bounty_old", bountyTitle: "Shovel the walk", role: "after" as const, dHash, sha256 });

describe("freshPhotos", () => {
  it("fails when before and after are the same image", () => {
    const r = freshPhotos(pair({ after: { dHash: "0000000000000000", sha256: "aa" } }), []);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/same picture/);
  });

  it("fails on a near duplicate 3 bits from an earlier proof and names its bounty", () => {
    const r = freshPhotos(pair(), [stored("00000000ffffff8f")]);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/Shovel the walk/);
    expect(r.detail).toMatch(/3 of 64 bits/);
  });

  it("passes when the closest earlier proof is 6 bits away", () => {
    const r = freshPhotos(pair(), [stored("00000000ffffff03")]);
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/6 bits away/);
  });

  it("fails on identical bytes even when the hashes differ", () => {
    const r = freshPhotos(pair(), [stored("ffffffffffffffff", "bb")]);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/identical bytes/);
  });
});

describe("timing", () => {
  it("passes photos taken between the claim and the deadline, before first", () => {
    expect(timing(pair(), CLAIM, DEADLINE, NOW).status).toBe("pass");
  });

  it("fails a photo taken before the claim", () => {
    const r = timing(pair({ before: { capturedAt: "2026-11-10T11:59:00.000Z" } }), CLAIM, DEADLINE, NOW);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/before the job was claimed/);
  });

  it("fails when the before photo is later than the after photo", () => {
    const r = timing(pair({ before: { capturedAt: "2026-11-10T12:50:00.000Z" } }), CLAIM, DEADLINE, NOW);
    expect(r.detail).toMatch(/before photo was taken after the after photo/);
  });

  it("fails a capture time 3 minutes in the future but allows 2", () => {
    const future = timing(pair({ after: { capturedAt: "2026-11-10T13:03:00.000Z" } }), CLAIM, DEADLINE, NOW);
    expect(future.status).toBe("fail");
    expect(future.detail).toMatch(/future/);
    expect(timing(pair({ after: { capturedAt: "2026-11-10T13:02:00.000Z" } }), CLAIM, DEADLINE, NOW).status).toBe("pass");
  });

  it("fails a photo taken after the deadline", () => {
    const late = new Date("2026-11-12T13:00:00.000Z");
    const r = timing(pair({ after: { capturedAt: "2026-11-12T12:30:00.000Z" } }), CLAIM, DEADLINE, late);
    expect(r.detail).toMatch(/after the deadline/);
  });
});

describe("location", () => {
  const site = { lat: 40, lng: -75, radiusM: 150 };

  it("measures distance in meters", () => {
    expect(haversineMeters(40, -75, 40.018, -75)).toBeGreaterThan(1900);
    expect(haversineMeters(40, -75, 40.018, -75)).toBeLessThan(2100);
  });

  it("fails a photo 2 km from a 150 m job site", () => {
    const r = location(pair({ after: { lat: 40.018, lng: -75 } }), site);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/2\.0 km/);
  });

  it("passes photos inside the radius", () => {
    expect(location(pair({ before: { lat: 40.0005, lng: -75 }, after: { lat: 40, lng: -75.0005 } }), site).status).toBe("pass");
  });

  it("marks photos without coordinates as not checked without failing", () => {
    const r = location(pair(), site);
    expect(r.status).toBe("skipped");
    expect(r.detail).toMatch(/Not checked/);
  });

  it("skips when the bounty has no job site", () => {
    expect(location(pair(), null).status).toBe("skipped");
  });
});
