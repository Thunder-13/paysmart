import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "permission-slip-seed-cli-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(): string {
  const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dir, PAYPAL_MODE: "mock", AI_MODE: "mock" };
  delete env.PAYPAL_CLIENT_ID;
  delete env.ANTHROPIC_API_KEY;
  return execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/demo-seed.ts"], { cwd: ROOT, encoding: "utf8", env });
}

function rows(out: string): string[] {
  return out.split("\n").filter((l) => /^(shop|second-look|bounty|cash-weather|toll-road|dispute-desk|paysmart)\s+run_/.test(l));
}

describe("npm run demo:seed", () => {
  it("prints seven finished runs with verified chains against a temp DATA_DIR, then adds nothing on a rerun", () => {
    const first = seed();
    expect(first).toContain("Loaded the demo story");
    expect(rows(first)).toHaveLength(7);
    for (const line of rows(first)) expect(line).toMatch(/\sdone\s.*\syes \(\d+\)/);
    expect(first).toContain("7 of 7 runs finished; 7 of 7 chains verified.");

    const second = seed();
    expect(second).toContain("already loaded");
    expect(rows(second).map((l) => l.split(/\s+/).slice(0, 3).join(" "))).toEqual(rows(first).map((l) => l.split(/\s+/).slice(0, 3).join(" ")));
  }, 60_000);
});
