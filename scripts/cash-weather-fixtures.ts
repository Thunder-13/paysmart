/**
 * Refreshes the Cash Weather npm fixtures from the live registry.
 *   npx tsx scripts/cash-weather-fixtures.ts
 * Reads the fixture package.json, fetches https://registry.npmjs.org/<name>/latest for each direct
 * dependency, and writes name, version, maintainer handles (no emails) and funding to
 * src/pipelines/cash-weather/fixtures/npm-registry.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isValidPackageName, normalizeDoc, registryUrl } from "../src/pipelines/cash-weather/registry";

const dir = path.join(process.cwd(), "src/pipelines/cash-weather/fixtures");
const pkg = JSON.parse(readFileSync(path.join(dir, "studio-package.json"), "utf8")) as { dependencies?: Record<string, string> };
const names = Object.keys(pkg.dependencies ?? {}).filter(isValidPackageName).sort();

async function main(): Promise<void> {
  const out: Record<string, { name: string; version: string | null; maintainers: { name: string }[]; funding: string | null }> = {};
  for (const name of names) {
    const res = await fetch(registryUrl(name), { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
    const meta = normalizeDoc(name, await res.json(), "registry", false);
    out[name] = { name, version: meta.version, maintainers: meta.maintainers.map((m) => ({ name: m })), funding: meta.funding };
    console.log(`${name.padEnd(12)} ${meta.version ?? "?"}  ${meta.maintainers.join(", ")}${meta.funding ? `  funding ${meta.funding}` : ""}`);
  }
  writeFileSync(path.join(dir, "npm-registry.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${Object.keys(out).length} packages to ${path.relative(process.cwd(), path.join(dir, "npm-registry.json"))}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
