# Tasks

Checks used below: `npx vitest run <file>`; "typecheck clean for X" means `npm run -s typecheck 2>&1 | grep -E "X"` prints nothing. Read `node_modules/next/dist/docs/` for route handler and dynamic params conventions before writing routes.

## 1. Core module

- [x] 1.1 Write `src/core/affiliate/index.ts` (schema, presets, `matchAccount`, `buildAffiliateUrl`, `affiliateLink`, `estimateCommission`) with `src/core/affiliate/affiliate.test.ts`; verify the test passes: Amazon tag added on `www.amazon.in`, existing `tag=other-20` replaced (exactly one `tag`), Flipkart `affid` added, template mode encodes the URL, `notamazon.in` and `amazon.in.evil.example` return null, inactive returns null, `ftp:` returns null, longest domain wins, $42.18 at 400 bps gives $1.68.
- [x] 1.2 Add `affiliateRepo(store)` in `src/core/affiliate/repo.ts` over `store.collection("core", "affiliate_accounts")`; verify `npx vitest run src/core/affiliate` passes: preset defaults filled, Instagram without params or template rejected, `http:` template rejected, update and remove work, records survive reopening a file-backed store in a temp dir.

## 2. Admin surface

- [x] 2.1 Write `src/server/admin-auth.ts` (`checkAffiliateAdmin`) with tests; verify `npx vitest run src/server/admin-auth.test.ts` passes (empty secret 404, missing bearer 401, wrong bearer 401, right bearer null).
- [x] 2.2 Write `src/app/api/affiliates/route.ts`, `src/app/api/affiliates/[id]/route.ts`, `src/app/api/affiliates/preview/route.ts` with `src/app/api/affiliates/routes.test.ts` calling the handlers directly; verify the test passes (create, list, patch, delete, preview, 400 on bad input, 404 without secret, 401 wrong bearer with no change).
- [x] 2.3 Write the `/affiliates` page (`src/app/affiliates/page.tsx` plus a client component); verify typecheck clean for `src/app/affiliates` and `npx eslint src/app/affiliates src/app/api/affiliates src/core/affiliate src/server/admin-auth.ts` exits 0.
- [x] 2.4 Write `scripts/affiliate-add.ts`; verify `DATA_DIR=$(mktemp -d) npx tsx scripts/affiliate-add.ts --network amazon --id leoshop-21` prints the new account and a following `--list` with the same `DATA_DIR` shows it.
- [x] 2.5 Add `AFFILIATE_ADMIN_SECRET` (commented, empty) to `.env.example`; verify `grep -c AFFILIATE_ADMIN_SECRET .env.example` prints at least 1.

## 3. Shop integration

- [x] 3.1 Add `url` to fixtures, `affiliate` to `Listing` and `CartLine`, `ShopState.affiliate`; load accounts in the `ShopSession` constructor; attach links in `search_products`; verify `npx vitest run src/pipelines/shop/tools.test.ts` passes new cases: with the demo account, Clockwork Rex's affiliate URL ends in `?ref=permission-slip-demo`; no tool result JSON contains `permission-slip-demo`, the account id or `ref=`; guard verdicts are identical with and without the account.
- [x] 3.2 Record `affiliate.attributed` in `settle` and `affiliate.reversed` in `refund`; verify `npx vitest run src/pipelines/shop/steps.settle.test.ts src/pipelines/shop/steps.delivery.test.ts` passes (estimate $1.68 on $42.18; reversed after a refund; no events when no account matches).
- [x] 3.3 Option cards link through the affiliate URL (`rel="sponsored noopener noreferrer"`), fixture links shown as text, disclosure line, commission figure in the ledger panel; verify typecheck clean for `src/app/p/shop` and `npx eslint src/app/p/shop` exits 0.

## 4. Demo and docs

- [x] 4.1 Seed the demo account in `src/server/demo-seed.ts` (mock rail only, once); verify `npx vitest run src/server/demo-seed.test.ts scripts/demo-seed.test.ts` passes with a case that seeding twice leaves 1 account and a sandbox-mode runtime gets none.
- [x] 4.2 README section "Affiliate links" (setup, presets, the Myntra/Instagram/Facebook note, admin secret, CLI, disclosure) and `AFFILIATE_ADMIN_SECRET` with `sync: false` in `render.yaml`; verify `grep -c "AFFILIATE_ADMIN_SECRET" README.md render.yaml` shows both files and `grep -c "—" README.md` prints 0.
- [x] 4.3 Verify `openspec validate add-affiliate-links --strict` passes.
