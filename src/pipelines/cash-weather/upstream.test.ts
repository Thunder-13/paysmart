import { describe, expect, it } from "vitest";
import type { PackageMeta } from "./types";
import { allocate, largestRemainder, packageWeight, receiverMap } from "./allocation";
import { buildGive, safeToGive, splitBudget } from "./budget";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON, REGISTRY_FIXTURE } from "./fixtures";
import { fetchPackageMeta, fundingUrl, normalizeDoc, registryUrl, type FetchLike } from "./registry";
import { mockExplanation, parseDependencies, percent } from "./upstream";

const fixtureMetas = (names: string[]) => fetchPackageMeta(names, { mode: "fixtures", fixtures: REGISTRY_FIXTURE });
const { map: RECEIVERS } = receiverMap(undefined);

function meta(name: string, maintainers: string[]): PackageMeta {
  return { name, version: "1.0.0", maintainers, funding: null, source: "fixture", offline: false, error: null };
}

describe("dependency parsing", () => {
  it("keeps valid direct dependencies and rejects crafted names", () => {
    const r = parseDependencies(JSON.stringify({ dependencies: { zod: "^4", "../../admin": "1", "evil?x=1": "1" }, devDependencies: { vitest: "4" } }));
    expect(r.names).toEqual(["zod"]);
    expect(r.rejected.sort()).toEqual(["../../admin", "evil?x=1"]);
    expect(() => registryUrl("../../admin")).toThrow();
    expect(registryUrl("@scope/pkg")).toBe("https://registry.npmjs.org/@scope%2fpkg/latest");
  });

  it("processes at most 50 dependencies in alphabetical order", () => {
    const deps = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`pkg-${String(i).padStart(2, "0")}`, "1.0.0"]));
    const r = parseDependencies(JSON.stringify({ dependencies: deps }));
    expect(r.names).toHaveLength(50);
    expect(r.names[0]).toBe("pkg-00");
    expect(r.skipped).toEqual(["pkg-50", "pkg-51", "pkg-52", "pkg-53", "pkg-54"]);
  });
});

describe("registry metadata", () => {
  it("never touches the network in fixtures mode", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const metas = await fetchPackageMeta(parseDependencies(DEFAULT_PACKAGE_JSON).names, { mode: "fixtures", fixtures: REGISTRY_FIXTURE, fetchImpl });
    expect(calls).toBe(0);
    expect(metas.find((m) => m.name === "zod")?.maintainers).toEqual(["colinhacks"]);
  });

  it("falls back to the fixture, flagged offline, when one live request times out", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("/pino/")) {
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      }
      const name = decodeURIComponent(url.split("/")[3]);
      return { ok: true, status: 200, json: async () => ({ ...(REGISTRY_FIXTURE[name] as object), maintainers: [{ name: "live-handle", email: "x@y.z" }] }) };
    };
    const metas = await fetchPackageMeta(["pino", "zod"], { mode: "live", fixtures: REGISTRY_FIXTURE, fetchImpl });
    expect(metas[0]).toMatchObject({ name: "pino", source: "fixture", offline: true });
    expect(metas[0].error).toMatch(/timed out/);
    expect(metas[1]).toMatchObject({ name: "zod", source: "registry", offline: false, maintainers: ["live-handle"] });
  });

  it("keeps only https funding links", () => {
    expect(fundingUrl("https://github.com/sponsors/x")).toBe("https://github.com/sponsors/x");
    expect(fundingUrl("javascript:alert(1)")).toBeNull();
    expect(fundingUrl([{ url: "http://insecure.example" }, { type: "x", url: "https://ok.example/" }])).toBe("https://ok.example/");
  });

  it("never turns a planted registry email into a receiver", () => {
    const planted = normalizeDoc("zod", { name: "zod", maintainers: [{ name: "evil", email: "pay-me@attacker.example" }, { name: "colinhacks", email: "c@example.com" }] }, "registry", false);
    const { packages, receivers } = allocate([planted], RECEIVERS);
    const all = JSON.stringify({ packages, receivers });
    expect(all).not.toContain("pay-me@attacker.example");
    expect(receivers.map((r) => r.handle)).toEqual(["colinhacks"]);
    expect(packages[0].mapped).toEqual(["colinhacks"]);
  });
});

describe("allocation", () => {
  it("split weights sum to 10000 with and without an import hint", async () => {
    const metas = await fixtureMetas(parseDependencies(DEFAULT_PACKAGE_JSON).names);
    for (const hint of [undefined, DEFAULT_IMPORT_COUNTS]) {
      const { receivers } = allocate(metas, RECEIVERS, hint);
      expect(receivers.length).toBeGreaterThan(0);
      expect(receivers.every((r) => Number.isInteger(r.weightBps) && r.weightBps >= 0)).toBe(true);
      expect(receivers.reduce((s, r) => s + r.weightBps, 0)).toBe(10000);
    }
  });

  it("boosts by import count up to double", () => {
    expect(packageWeight(20)).toBe(2);
    expect(packageWeight(500)).toBe(2);
    expect(packageWeight(0)).toBe(1);
    const { receivers } = allocate([meta("a", ["colinhacks"]), meta("b", ["eemeli"])], RECEIVERS, { a: 20, b: 0 });
    const [first, second] = receivers;
    expect(first.handle).toBe("colinhacks");
    expect(Math.abs(first.weightBps - 2 * second.weightBps)).toBeLessThanOrEqual(1);
  });

  it("lists a package whose maintainers have no receiver as having no route", async () => {
    const metas = await fixtureMetas(["semver", "zod"]);
    const { packages, receivers } = allocate(metas, RECEIVERS);
    expect(packages.find((p) => p.name === "semver")).toMatchObject({ route: false, mapped: [] });
    expect(receivers.map((r) => r.handle)).toEqual(["colinhacks"]);
    expect(receivers[0].weightBps).toBe(10000);
  });

  it("merges environment receivers and ignores bad JSON", () => {
    expect(receiverMap('{"semver-maint":"sb-x@personal.example.com"}').map["semver-maint"]).toBe("sb-x@personal.example.com");
    expect(receiverMap("{not json").problem).toMatch(/not valid JSON/);
    expect(receiverMap('{"a":"not-an-email"}').problem).toMatch(/must map/);
  });

  it("explains the split naming every receiving handle with its percentage", async () => {
    const metas = await fixtureMetas(parseDependencies(DEFAULT_PACKAGE_JSON).names);
    const { packages, receivers } = allocate(metas, RECEIVERS, DEFAULT_IMPORT_COUNTS);
    const text = mockExplanation(packages, receivers, true);
    for (const r of receivers) expect(text).toContain(`${r.handle} ${percent(r.weightBps)}`);
    expect(text).toContain("semver");
  });
});

describe("safe to give", () => {
  it("lets the cap bind", () => {
    expect(safeToGive(900000, 200000, 15000)).toEqual({ surplusCents: 700000, tenPercentCents: 70000, budgetCents: 15000 });
  });

  it("gives nothing when the low case leaves no room", () => {
    expect(safeToGive(180000, 200000, 15000).budgetCents).toBe(0);
    expect(safeToGive(200900, 200000, 15000).budgetCents).toBe(0); // 10% of $9 is under $1
    const give = buildGive({ day30P10Cents: 180000, bufferCents: 200000, capCents: 15000, receivers: [{ handle: "a", email: "a@x.io", weightBps: 10000, packages: ["a"] }] });
    expect(give.budget.value).toBe("0.00");
    expect(give.payouts).toEqual([]);
    expect(give.lines.join(" ")).toMatch(/no room above your buffer/);
  });

  it("splits 87.00 so amounts sum to the budget, each within a cent of its share", () => {
    const rows = [
      { handle: "a", email: "a@x.io", weightBps: 3334, packages: [] },
      { handle: "b", email: "b@x.io", weightBps: 3333, packages: [] },
      { handle: "c", email: "c@x.io", weightBps: 3333, packages: [] },
    ];
    const { payouts } = splitBudget(8700, rows);
    expect(payouts.reduce((s, p) => s + p.amountCents, 0)).toBe(8700);
    for (const p of payouts) {
      expect(p.amountCents).toBeGreaterThanOrEqual(100);
      expect(Math.abs(p.amountCents - Math.round((8700 * p.weightBps) / 10000))).toBeLessThanOrEqual(1);
    }
  });

  it("drops a receiver under $1.00 and renormalizes to 10000", () => {
    const rows = [
      { handle: "big", email: "big@x.io", weightBps: 9950, packages: [] },
      { handle: "tiny", email: "tiny@x.io", weightBps: 50, packages: [] },
    ];
    const { payouts, dropped } = splitBudget(1500, rows);
    expect(dropped).toEqual(["tiny"]);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ handle: "big", weightBps: 10000, amountCents: 1500 });
  });

  it("rounds with the largest remainder", () => {
    expect([...largestRemainder([{ key: "x", weight: 1 }, { key: "y", weight: 1 }, { key: "z", weight: 1 }], 10000).values()]).toEqual([3334, 3333, 3333]);
  });
});
