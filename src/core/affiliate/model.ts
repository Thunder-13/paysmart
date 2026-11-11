/**
 * Affiliate accounts, network presets and the pure link builder. No network calls, no AI, and it
 * never reads listing text: the only input is a URL and the stored accounts.
 */
import { z } from "zod";
import type { Money } from "@/core/contracts";
import { fromCents, toCents } from "@/core/money";

export const AFFILIATE_NETWORKS = ["amazon", "flipkart", "myntra", "instagram", "facebook", "generic"] as const;
export type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const Hostname = z
  .string()
  .max(253)
  .regex(new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})+$`), "Use a lowercase domain such as amazon.in, with no scheme or path.");
const ParamKey = z.string().regex(/^[A-Za-z0-9._~-]{1,40}$/, "Parameter names use letters, digits and . _ ~ - only.");
const TrackingId = z.string().regex(/^[A-Za-z0-9._~-]{2,64}$/, "Tracking ID is 2 to 64 characters: letters, digits and . _ ~ -");

/** Fills `{url}` and `{id}` the way template mode does, so a template can be checked up front. */
function fillTemplate(template: string, rawUrl: string, trackingId: string): string {
  return template.replaceAll("{url}", encodeURIComponent(rawUrl)).replaceAll("{id}", encodeURIComponent(trackingId));
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export const AffiliateAccountSchema = z
  .object({
    id: z.string(),
    network: z.enum(AFFILIATE_NETWORKS),
    label: z.string().trim().min(1).max(80),
    trackingId: TrackingId,
    domains: z.array(Hostname).min(1).max(20),
    params: z.record(ParamKey, z.string().max(200)),
    template: z.string().max(500).nullable(),
    commissionBps: z.number().int().min(0).max(10000).nullable(),
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((a, ctx) => {
    if (a.template !== null) {
      if (!a.template.includes("{url}")) {
        ctx.addIssue({ code: "custom", path: ["template"], message: "The template must contain {url}, where the original link goes." });
      } else if (!isHttps(fillTemplate(a.template, "https://example.com/p/1", a.trackingId))) {
        ctx.addIssue({ code: "custom", path: ["template"], message: "The template must build an https link." });
      }
    } else if (Object.keys(a.params).length === 0) {
      ctx.addIssue({ code: "custom", path: ["params"], message: "Add link parameters or a template." });
    }
  });

export type AffiliateAccount = z.infer<typeof AffiliateAccountSchema>;

export interface NetworkPreset {
  label: string;
  domains: string[];
  params: Record<string, string>;
  needsUserLink: boolean;
  note: string;
}

export const NETWORK_PRESETS: Record<AffiliateNetwork, NetworkPreset> = {
  amazon: {
    label: "Amazon Associates",
    domains: ["amazon.com", "amazon.in", "amazon.co.uk", "amazon.ca", "amazon.de"],
    params: { tag: "{id}" },
    needsUserLink: false,
    note: "Use your Associates store ID as the tracking ID, for example leoshop-21.",
  },
  flipkart: {
    label: "Flipkart Affiliate",
    domains: ["flipkart.com"],
    params: { affid: "{id}" },
    needsUserLink: false,
    note: "Use your Flipkart affiliate ID as the tracking ID.",
  },
  myntra: {
    label: "Myntra",
    domains: ["myntra.com"],
    params: {},
    needsUserLink: true,
    note: "Myntra has no direct affiliate program. Most owners join through an affiliate network. Paste the deep-link template that network gave you, with {url} where the original link goes, or the query parameters it asked you to add.",
  },
  instagram: {
    label: "Instagram",
    domains: ["instagram.com"],
    params: {},
    needsUserLink: true,
    note: "Instagram has no public URL parameter for affiliates. Paste the deep-link template or the query parameters your program gave you.",
  },
  facebook: {
    label: "Facebook",
    domains: ["facebook.com", "fb.com"],
    params: {},
    needsUserLink: true,
    note: "Facebook has no public URL parameter for affiliates. Paste the deep-link template or the query parameters your program gave you.",
  },
  generic: {
    label: "Generic",
    domains: [],
    params: {},
    needsUserLink: true,
    note: "For any other retailer. List the domains to rewrite, then add the parameters or deep-link template from your program.",
  },
};

export interface AffiliateLink {
  url: string;
  accountId: string;
  network: AffiliateNetwork;
  label: string;
  commissionBps: number | null;
}

function parseWebUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

function hostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/** Active account whose domain equals the host or is a parent of it. Longest domain wins, then oldest. */
export function matchAccount(rawUrl: string, accounts: AffiliateAccount[]): AffiliateAccount | null {
  const url = parseWebUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let best: { account: AffiliateAccount; length: number } | null = null;
  for (const account of accounts) {
    if (!account.active) continue;
    let length = -1;
    for (const domain of account.domains) {
      if (hostMatches(host, domain)) length = Math.max(length, domain.length);
    }
    if (length < 0) continue;
    if (
      !best ||
      length > best.length ||
      (length === best.length &&
        (account.createdAt < best.account.createdAt || (account.createdAt === best.account.createdAt && account.id < best.account.id)))
    ) {
      best = { account, length };
    }
  }
  return best ? best.account : null;
}

/** The affiliate URL for one account (the account's active flag and domains are not checked here). */
export function buildAffiliateUrl(rawUrl: string, account: AffiliateAccount): string | null {
  const url = parseWebUrl(rawUrl);
  if (!url) return null;
  if (account.template !== null) {
    const built = fillTemplate(account.template, rawUrl, account.trackingId);
    return isHttps(built) ? built : null;
  }
  if (Object.keys(account.params).length === 0) return null;
  for (const [key, value] of Object.entries(account.params)) {
    url.searchParams.set(key, value.replaceAll("{id}", account.trackingId));
  }
  return url.toString();
}

export function affiliateLink(rawUrl: string | null, accounts: AffiliateAccount[]): AffiliateLink | null {
  if (!rawUrl) return null;
  const account = matchAccount(rawUrl, accounts);
  if (!account) return null;
  const url = buildAffiliateUrl(rawUrl, account);
  if (!url) return null;
  return { url, accountId: account.id, network: account.network, label: account.label, commissionBps: account.commissionBps };
}

/** Commission estimate in whole cents, floored: $42.18 at 400 bps is $1.68. */
export function estimateCommission(amount: Money, bps: number | null): Money | null {
  if (bps === null) return null;
  return fromCents(Math.floor((toCents(amount) * bps) / 10000), amount.currency);
}
