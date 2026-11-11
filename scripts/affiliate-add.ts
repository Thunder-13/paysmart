/**
 * Add, list or remove affiliate accounts straight in the SQLite file, no admin secret needed.
 *
 *   npx tsx scripts/affiliate-add.ts --network amazon --id leoshop-21
 *   npx tsx scripts/affiliate-add.ts --network generic --id demo-1 --domains shop.example --param ref={id} --commission 4
 *   npx tsx scripts/affiliate-add.ts --network instagram --id leo.gifts --template "https://go.example/?u={url}&s={id}"
 *   npx tsx scripts/affiliate-add.ts --list
 *   npx tsx scripts/affiliate-add.ts --remove aff_xxxxxxxx
 *
 * Opens ${DATA_DIR:-./data}/permission-slip.db, the same file the app uses.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AFFILIATE_NETWORKS, AffiliateInputError, affiliateRepo, type AffiliateAccount, type AffiliateNetwork } from "../src/core/affiliate";
import { createSqliteStore } from "../src/core/store/sqlite";

const USAGE = `Usage:
  affiliate-add --list
  affiliate-add --remove <id>
  affiliate-add --network <${AFFILIATE_NETWORKS.join("|")}> --id <trackingId> [--label <text>] [--domains a,b]
                [--param k=v]... [--template <https url with {url}>] [--commission <percent>] [--inactive]`;

function describe(a: AffiliateAccount): string {
  const how = a.template ? `template ${a.template}` : `params ${Object.entries(a.params).map(([k, v]) => `${k}=${v}`).join("&")}`;
  const rate = a.commissionBps === null ? "no rate" : `${a.commissionBps / 100}%`;
  return `${a.id}  ${a.network}  ${a.trackingId}  ${a.active ? "on" : "off"}  ${rate}  ${a.domains.join(",")}  ${how}  "${a.label}"`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean" },
      remove: { type: "string" },
      network: { type: "string" },
      id: { type: "string" },
      label: { type: "string" },
      domains: { type: "string" },
      param: { type: "string", multiple: true },
      template: { type: "string" },
      commission: { type: "string" },
      inactive: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) return console.log(USAGE);

  const dir = process.env.DATA_DIR || "./data";
  mkdirSync(dir, { recursive: true });
  const store = createSqliteStore(path.join(dir, "permission-slip.db"));
  try {
    const repo = affiliateRepo(store);
    if (values.list) {
      const accounts = repo.list();
      console.log(accounts.length ? accounts.map(describe).join("\n") : "No affiliate accounts.");
      return;
    }
    if (values.remove) {
      if (!repo.remove(values.remove)) fail(`No account ${values.remove}.`);
      console.log(`Removed ${values.remove}.`);
      return;
    }
    if (!values.network || !values.id) fail(USAGE);
    if (!(AFFILIATE_NETWORKS as readonly string[]).includes(values.network)) fail(`Unknown network "${values.network}". Use one of ${AFFILIATE_NETWORKS.join(", ")}.`);
    const params: Record<string, string> = {};
    for (const p of values.param ?? []) {
      const at = p.indexOf("=");
      if (at < 1) fail(`--param needs name=value, got "${p}".`);
      params[p.slice(0, at)] = p.slice(at + 1);
    }
    let commissionBps: number | null = null;
    if (values.commission !== undefined) {
      const percent = Number(values.commission);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail("--commission is a percent from 0 to 100.");
      commissionBps = Math.round(percent * 100);
    }
    const account = repo.create({
      network: values.network as AffiliateNetwork,
      trackingId: values.id,
      label: values.label,
      domains: values.domains?.split(",").map((d) => d.trim()).filter(Boolean),
      params: Object.keys(params).length ? params : undefined,
      template: values.template ?? null,
      commissionBps,
      active: !values.inactive,
    });
    console.log("Added " + describe(account));
  } catch (e) {
    if (e instanceof AffiliateInputError) fail(`Not saved: ${e.message}`);
    throw e;
  } finally {
    store.close();
  }
}

main();
