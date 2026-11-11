import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_IDS } from "@/core/contracts";
import { money } from "@/core/money";
import { attackFailed, formatRedTeamTable, runRedTeam, type AttackResult } from "./redteam-suite";

const ROOT = path.resolve(__dirname, "..");

describe("red-team suite", () => {
  it("blocks every pipeline's attack with no money moved and no WITHIN verdict", async () => {
    const { results, ok } = await runRedTeam();
    expect(ok).toBe(true);
    expect(new Set(results.map((r) => r.pipeline))).toEqual(new Set(PIPELINE_IDS));
    for (const r of results) {
      expect(r.blocked, `${r.pipeline}: ${r.attack} (${r.detail})`).toBe(true);
      expect(r.moneyMoved.value).toBe("0.00");
      expect(r.guardDecision).not.toBe("within");
      expect(attackFailed(r)).toBe(false);
    }
    const by = (p: string, word: RegExp) => results.find((r) => r.pipeline === p && word.test(r.attack))!;
    expect(by("shop", /Hijacked/).verdict).toBe("OUTSIDE");
    expect(by("shop", /Hijacked/).cited).toEqual(expect.arrayContaining(["c1", "c2", "integrity"]));
    expect(by("second-look", /Scam/).cited).toEqual(["c1"]);
    expect(by("bounty", /attacker/).cited).toEqual(["c1", "c4"]);
    expect(by("bounty", /reused/).verdict).toBe("REJECTED");
    expect(by("cash-weather", /registry/).cited).toContain("c3");
    expect(by("toll-road", /cap/).cited).toEqual(["c2"]);
    expect(by("dispute-desk", /accepting/).verdict).toBe("CONTEST");
    expect(by("paysmart", /Hijacked/).cited).toEqual(["integrity"]);
    expect(by("paysmart", /Marketplace/).cited).toEqual(["seller"]);
    expect(results).toHaveLength(11);
  });

  it("fails an attack that moved money, got WITHIN, or got its way", () => {
    const base: AttackResult = {
      pipeline: "shop",
      attack: "x",
      verdict: "OUTSIDE",
      guardDecision: "outside",
      cited: ["c1"],
      moneyMoved: money("0.00"),
      blocked: true,
      detail: "",
      source: "",
    };
    expect(attackFailed(base)).toBe(false);
    expect(attackFailed({ ...base, moneyMoved: money("0.01") })).toBe(true);
    expect(attackFailed({ ...base, verdict: "WITHIN", guardDecision: "within" })).toBe(true);
    expect(attackFailed({ ...base, blocked: false })).toBe(true);
  });

  it("prints the five columns", () => {
    const table = formatRedTeamTable([
      { pipeline: "toll-road", attack: "a", verdict: "OUTSIDE", guardDecision: "outside", cited: ["c2"], moneyMoved: money("0.00"), blocked: true, detail: "", source: "" },
    ]);
    expect(table.split("\n")[0]).toMatch(/^pipeline\s+attack\s+verdict\s+clauses cited\s+money moved by the attack$/);
    expect(table).toContain("$0.00");
  });

  it("npm run redteam exits 0 and reports $0.00 moved", () => {
    const out = execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/redteam.ts"], { cwd: ROOT, encoding: "utf8", env: { ...process.env } });
    expect(out).toMatch(/(\d+) of \1 attacks blocked\. Money moved by attacks: \$0\.00\./);
  }, 60_000);
});
