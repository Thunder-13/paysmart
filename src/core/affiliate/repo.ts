import { z } from "zod";
import type { Collection, Store } from "@/core/contracts";
import { newId } from "@/core/ids";
import { AFFILIATE_NETWORKS, AffiliateAccountSchema, NETWORK_PRESETS, type AffiliateAccount, type AffiliateNetwork } from "./model";

export interface AffiliateAccountInput {
  network: AffiliateNetwork;
  label?: string;
  trackingId: string;
  domains?: string[];
  params?: Record<string, string>;
  template?: string | null;
  commissionBps?: number | null;
  active?: boolean;
}

export interface AffiliateIssue {
  path: string;
  message: string;
}

/** Bad input. `issues` carries one entry per problem for the API's 400 body. */
export class AffiliateInputError extends Error {
  readonly issues: AffiliateIssue[];
  constructor(message: string, issues: AffiliateIssue[] = []) {
    super(message);
    this.name = "AffiliateInputError";
    this.issues = issues.length ? issues : [{ path: "", message }];
  }
}

export class AffiliateNotFoundError extends Error {
  constructor(id: string) {
    super(`affiliate account ${id} not found`);
    this.name = "AffiliateNotFoundError";
  }
}

const InputShape = z.object({
  network: z.enum(AFFILIATE_NETWORKS),
  label: z.string().optional(),
  trackingId: z.string(),
  domains: z.array(z.string()).optional(),
  params: z.record(z.string(), z.string()).optional(),
  template: z.string().nullable().optional(),
  commissionBps: z.number().nullable().optional(),
  active: z.boolean().optional(),
});

function issuesOf(error: z.ZodError): AffiliateInputError {
  const issues = error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
  return new AffiliateInputError(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), issues);
}

function cleanDomains(domains: string[]): string[] {
  return [...new Set(domains.map((d) => d.trim().toLowerCase()).filter((d) => d !== ""))];
}

function validate(account: AffiliateAccount): AffiliateAccount {
  const parsed = AffiliateAccountSchema.safeParse(account);
  if (!parsed.success) throw issuesOf(parsed.error);
  return parsed.data;
}

function needsLinkError(network: AffiliateNetwork): AffiliateInputError {
  const preset = NETWORK_PRESETS[network];
  return new AffiliateInputError(`${preset.label} needs a template or parameters from the owner's program. ${preset.note}`, [
    { path: "params", message: preset.note },
  ]);
}

function byAge(a: AffiliateAccount, b: AffiliateAccount): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

export function affiliateRepo(store: Store, now: () => Date = () => new Date()) {
  const col: Collection<AffiliateAccount> = store.collection<AffiliateAccount>("core", "affiliate_accounts");

  function list(): AffiliateAccount[] {
    // A hand-edited record that no longer validates is skipped, so one bad row can't break shopping.
    return col
      .list()
      .map((doc) => AffiliateAccountSchema.safeParse(doc))
      .flatMap((r) => (r.success ? [r.data] : []))
      .sort(byAge);
  }

  function get(id: string): AffiliateAccount | null {
    const doc = col.get(id);
    if (!doc) return null;
    const parsed = AffiliateAccountSchema.safeParse(doc);
    return parsed.success ? parsed.data : null;
  }

  return {
    list,
    active: (): AffiliateAccount[] => list().filter((a) => a.active),
    get,

    create(input: AffiliateAccountInput): AffiliateAccount {
      const parsed = InputShape.safeParse(input);
      if (!parsed.success) throw issuesOf(parsed.error);
      const i = parsed.data;
      const preset = NETWORK_PRESETS[i.network];
      const template = i.template?.trim() ? i.template.trim() : null;
      const userParams = i.params ?? {};
      const hasUserParams = Object.keys(userParams).length > 0;
      if (preset.needsUserLink && !hasUserParams && template === null) throw needsLinkError(i.network);
      const domains = i.domains && cleanDomains(i.domains).length ? cleanDomains(i.domains) : preset.domains;
      if (domains.length === 0) {
        throw new AffiliateInputError("Add at least one domain to rewrite.", [{ path: "domains", message: "Add at least one domain to rewrite." }]);
      }
      const stamp = now().toISOString();
      const account = validate({
        id: newId("aff"),
        network: i.network,
        label: i.label?.trim() ? i.label : preset.label,
        trackingId: i.trackingId.trim(),
        domains,
        params: hasUserParams ? userParams : template !== null ? {} : { ...preset.params },
        template,
        commissionBps: i.commissionBps ?? null,
        active: i.active ?? true,
        createdAt: stamp,
        updatedAt: stamp,
      });
      return col.put(account.id, account);
    },

    update(id: string, patch: Partial<AffiliateAccountInput>): AffiliateAccount {
      const current = get(id);
      if (!current) throw new AffiliateNotFoundError(id);
      const parsed = InputShape.partial().safeParse(patch);
      if (!parsed.success) throw issuesOf(parsed.error);
      const p = parsed.data;
      const template = p.template === undefined ? current.template : p.template?.trim() ? p.template.trim() : null;
      const merged: AffiliateAccount = {
        ...current,
        network: p.network ?? current.network,
        label: p.label !== undefined ? p.label : current.label,
        trackingId: p.trackingId !== undefined ? p.trackingId.trim() : current.trackingId,
        domains: p.domains !== undefined ? cleanDomains(p.domains) : current.domains,
        params: p.params ?? current.params,
        template,
        commissionBps: p.commissionBps === undefined ? current.commissionBps : p.commissionBps,
        active: p.active ?? current.active,
        updatedAt: now().toISOString(),
      };
      if (NETWORK_PRESETS[merged.network].needsUserLink && Object.keys(merged.params).length === 0 && merged.template === null) {
        throw needsLinkError(merged.network);
      }
      const account = validate(merged);
      return col.put(account.id, account);
    },

    remove(id: string): boolean {
      if (!col.get(id)) return false;
      col.remove(id);
      return true;
    },
  };
}

export type AffiliateRepo = ReturnType<typeof affiliateRepo>;
