# Proposal: affiliate links from the owner's own IDs

## Why

Permission Slip does real work for the buyer: it searches, checks every listing against the slip, holds and moves the money, and handles refunds. It earns nothing for that today. Retailers pay affiliates a small commission on sales they refer. If every retailer link the app hands out carries the owner's affiliate ID, each purchase pays a little toward running the service, and the buyer pays the same price.

The IDs must come from a database, not from code or env vars, so the owner can add, change or switch off a program without a deploy.

## What changes

- New core module `src/core/affiliate/`: account schema, network presets, a pure link builder and a repository over `store.collection("core", "affiliate_accounts")` (SQLite `docs` table, no schema change).
- Presets for `amazon` (Associates `tag`), `flipkart` (`affid`), `myntra`, `instagram`, `facebook` and `generic`. Myntra, Instagram and Facebook have no public link parameter for affiliates, so those accounts need either the query parameters the owner's program gave them or a deep-link template from their affiliate network with a `{url}` placeholder.
- Admin API under `/api/affiliates` (list, create, update, delete, preview a link) behind `Authorization: Bearer <AFFILIATE_ADMIN_SECRET>`. With the secret empty the routes answer 404, the same pattern as `CRON_SECRET`.
- Admin page `/affiliates` to manage accounts and test a link, and a CLI `scripts/affiliate-add.ts` that writes the same table directly.
- Shop integration: before the agent searches, the session loads the active accounts. Every search result's retailer URL is rewritten to an affiliate URL by the deterministic builder. The agent never sees affiliate URLs or IDs and can't pick or change them. Option cards link through the affiliate URL with `rel="sponsored"` and a disclosure line.
- Ledger: `affiliate.attributed` after a successful capture (account, network, affiliate URL, line total, estimated commission) and `affiliate.reversed` after a refund.
- Demo: in mock mode, `demo:seed` adds one clearly labelled demo account for the sample shops so the offline demo shows tagged links.

## Capabilities

### New capabilities

- `affiliate-links`: DB-held affiliate accounts, deterministic link rewriting, admin API, page and CLI, and shop attribution.

### Modified capabilities

None archived. Shop integration builds on `add-shop-pipeline` and `add-shop-choices`.

## PayPal APIs exercised

None. Affiliate links don't touch the PayPal rail, the hold, the capture amount or the guard.

## AI capabilities exercised

None. Link rewriting is plain TypeScript. Listing text never reaches it; only the listing URL from the catalog does.

## Impact

- New: `src/core/affiliate/**`, `src/server/admin-auth.ts`, `src/app/api/affiliates/**`, `src/app/affiliates/**`, `scripts/affiliate-add.ts`.
- Changed: `src/pipelines/shop/{types,fixtures,tools,steps}.ts`, `src/app/p/shop/**`, `src/server/demo-seed.ts`, `.env.example`, `render.yaml`, `README.md`.
- New env var `AFFILIATE_ADMIN_SECRET`. No new dependencies, no contract change.

## Non-goals

- Calling affiliate network APIs (Amazon PA-API, network link generators). Links are built from the stored ID and template only.
- Commission reporting from the networks. The ledger shows an estimate from the stored rate.
- Short links (`amzn.to` and similar). A URL whose host matches no account domain is left as is.
- Encrypting tracking IDs. They appear in every link the app shows, so they are not secrets. The admin secret is.
- Splitting commission with buyers or helpers.
