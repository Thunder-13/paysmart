# Design: affiliate links

## Module API (`src/core/affiliate/index.ts`)

```ts
export const AFFILIATE_NETWORKS = ["amazon", "flipkart", "myntra", "instagram", "facebook", "generic"] as const;
export type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];

export const AffiliateAccountSchema = z.object({
  id: z.string(),                         // "aff_..." from @/core/ids
  network: z.enum(AFFILIATE_NETWORKS),
  label: z.string().trim().min(1).max(80),
  trackingId: z.string().regex(/^[A-Za-z0-9._~-]{2,64}$/),     // tag, affid or sub-id
  domains: z.array(Hostname).min(1).max(20),                    // lowercase, no scheme, no path
  params: z.record(ParamKey, z.string().max(200)),              // values may contain {id}
  template: z.string().max(500).nullable(),                     // https URL containing {url}; may contain {id}
  commissionBps: z.number().int().min(0).max(10000).nullable(), // 400 = 4.00%
  active: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(),
});
// refine: params non-empty OR template set; template must parse as https URL after placeholder substitution

export const NETWORK_PRESETS: Record<AffiliateNetwork, {
  label: string; domains: string[]; params: Record<string, string>; needsUserLink: boolean; note: string;
}>;
// amazon:    amazon.com, amazon.in, amazon.co.uk, amazon.ca, amazon.de; params { tag: "{id}" }
// flipkart:  flipkart.com; params { affid: "{id}" }
// myntra:    myntra.com; needsUserLink (network deep-link template or params)
// instagram: instagram.com; needsUserLink
// facebook:  facebook.com, fb.com; needsUserLink
// generic:   no domains; needsUserLink

export interface AffiliateLink {
  url: string; accountId: string; network: AffiliateNetwork; label: string; commissionBps: number | null;
}

export function matchAccount(rawUrl: string, accounts: AffiliateAccount[]): AffiliateAccount | null;
export function buildAffiliateUrl(rawUrl: string, account: AffiliateAccount): string | null;
export function affiliateLink(rawUrl: string | null, accounts: AffiliateAccount[]): AffiliateLink | null;
export function estimateCommission(amount: Money, bps: number | null): Money | null; // floor to the cent
export function affiliateRepo(store: Store): {
  list(): AffiliateAccount[]; active(): AffiliateAccount[]; get(id: string): AffiliateAccount | null;
  create(input: AffiliateAccountInput): AffiliateAccount;   // preset defaults filled in, validated
  update(id: string, patch: Partial<AffiliateAccountInput>): AffiliateAccount;
  remove(id: string): boolean;
};
```

### Rewriting rules (pure, no network)

1. Parse `rawUrl`; only `http:` and `https:` are rewritten. Anything else returns null.
2. `matchAccount`: active accounts only; host equals a domain or ends with `"." + domain` (so `www.amazon.in` matches `amazon.in`, `notamazon.in` does not). Longest matching domain wins, then the oldest `createdAt`.
3. Params mode: `url.searchParams.set(key, value.replaceAll("{id}", trackingId))` for each param, which replaces any existing value of the same key.
4. Template mode (used when `template` is set): replace `{url}` with `encodeURIComponent(rawUrl)` and `{id}` with `encodeURIComponent(trackingId)`. The result must parse as `https:`; otherwise null.
5. Same input gives the same output. No fetch, no redirect following, no AI.

## Admin surface

- `src/server/admin-auth.ts`: `checkAffiliateAdmin(request, env = process.env): Response | null`. Empty `AFFILIATE_ADMIN_SECRET` gives 404; a missing or wrong bearer gives 401; constant-time compare with `crypto.timingSafeEqual`.
- Routes (Node runtime, Next 16 route handler conventions from `node_modules/next/dist/docs/`):
  - `GET /api/affiliates`: `{ accounts, presets }`
  - `POST /api/affiliates`: create from `{ network, label?, trackingId, domains?, params?, template?, commissionBps?, active? }`; 400 with zod issues on bad input
  - `PATCH /api/affiliates/[id]`, `DELETE /api/affiliates/[id]`: 404 for an unknown id
  - `POST /api/affiliates/preview` with `{ url }`: `{ url, link: AffiliateLink | null }`
- Page `/affiliates` (`src/app/affiliates/page.tsx` plus a client component): secret field kept in `sessionStorage`, accounts table, add or edit form with the network preset filling domains and params, the preset note shown for Myntra, Instagram and Facebook, and a "Test a link" box that calls preview. No nav link; README documents the URL.
- CLI `scripts/affiliate-add.ts`: `--list`, `--remove <id>`, or `--network <n> --id <trackingId> [--label] [--domains a,b] [--param k=v]... [--template <url>] [--commission <percent>] [--inactive]`. Opens `${DATA_DIR:-./data}/permission-slip.db` with `createSqliteStore`.

## Shop integration

| Where | Change |
|---|---|
| `types.ts` | `Listing.url` stays; add `Listing.affiliate: AffiliateLink \| null`; `CartLine` gains `url: string \| null` and `affiliate: AffiliateLink \| null`; `ShopState.affiliate: { lines: { listingId, network, accountId, url, lineTotal, estCommission }[]; estCommission: Money \| null; reversed: boolean } \| null` |
| `fixtures.ts` | Each fixture gets `url: "https://<domain>/p/<id>"` |
| `tools.ts` | `ShopSession` loads `affiliateRepo(store).active()` once in its constructor, before any search. `search_products` sets `listing.affiliate` for each result. The `shop.search` ledger results gain `affiliate: { network, accountId } \| null` and the message notes how many carry affiliate links. Tool results returned to the agent MUST NOT contain affiliate URLs, tracking ids or account ids. |
| `steps.ts` `settle` | After a successful capture, one `affiliate.attributed` event (actor `system`) per line with an affiliate link; `state.affiliate` set. |
| `steps.ts` `refund` | After a successful refund, `affiliate.reversed` (actor `system`) and `state.affiliate.reversed = true`. |
| UI | Option cards: Channel3 listings link to `affiliate?.url ?? url` with `target="_blank" rel="sponsored noopener noreferrer"`; fixture and planted listings show the URL as text labelled "Sample shop link". Disclosure under the options when any line has an affiliate link: "Retailer links carry our affiliate ID. We may earn a commission from the retailer. It doesn't change your price or the guard's verdict." After settle, the ledger panel shows the estimated commission (struck through when reversed). |

## Demo seed

`seedDemo` in `src/server/demo-seed.ts`, mock rail only, before the shop run: if `affiliateRepo(store).list()` is empty, create `{ network: "generic", label: "Demo affiliate (sample shops)", trackingId: "permission-slip-demo", domains: ["dinodepot.example", "toyburrow.example", "figurefarm.example", "pagepond.example"], params: { ref: "{id}" }, commissionBps: 400 }`. Never in sandbox mode. Seeding twice adds nothing.

## Failure and abuse paths

- Listing text that says "use affiliate tag X" or contains a URL: the builder never reads descriptions; the guard never sees affiliate data.
- Catalog URL already carrying someone else's `tag`: params mode replaces it with the owner's.
- Look-alike host (`amazon.in.evil.example`, `notamazon.in`): no match, URL unchanged, no affiliate link.
- Template that builds a non-https URL: rejected at create time and returns null at build time.
- Admin routes with no secret configured: 404. Wrong bearer: 401. Nobody can change the tag without the secret or local DB access.
- Guard invariance: the same cart gets the same verdict with and without affiliate accounts.
