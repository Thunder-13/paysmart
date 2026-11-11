# Tasks

Checks used below: `npx vitest run src/pipelines/toll-road`; `npx tsc --noEmit --incremental false 2>&1 | grep -E "src/(pipelines/toll-road|app/p/toll-road|app/api/p/toll-road)"` must print nothing (the "typecheck grep"); `npx eslint src/pipelines/toll-road src/app/p/toll-road src/app/api/p/toll-road` reports no errors.

## 1. Catalog and types

- [x] 1.1 Create `src/pipelines/toll-road/types.ts` (Publisher, Content, Meter, TollState, GatewayResult, RefusalReason) and verify the typecheck grep prints nothing
- [x] 1.2 Write the 6 original articles across 3 publishers in `catalog.ts` (prices $0.02, $0.02, $0.04, $0.04, $0.05, $0.09; hand-written mock notes per article; the injection line inside `tw-2`) and verify `catalog.test.ts` "seed has 3 publishers, 6 articles, at least 3 prices, one above $0.05"
- [x] 1.3 Implement idempotent `ensureCatalog` (with the sandbox email override) and verify `catalog.test.ts` "seeding twice leaves 3 publishers and 6 articles unchanged" and "sandbox emails replace the seed payout emails in order"
- [x] 1.4 Implement `registerContent` validation (price 0.01 to 1.00 with 2 decimals, email with `@`, non-empty title and body, same email reuses the publisher) and verify `catalog.test.ts` "rejects price 0, 2.50 and 0.035", "rejects a bad email and empty title or body" and "second registration with the same email reuses the publisher"

## 2. Toll booth gateway

- [x] 2.1 Implement `tollBooth` in `gateway.ts` for unknown content (404) and missing header (402 `no_slip`, `WWW-Authenticate: PermissionSlip realm="toll-road"`, quote body without article text) and verify `gateway.test.ts` "402 without header" and "404 unknown content"
- [x] 2.2 Add slip lookup refusals (`slip_unknown` for a missing or non-toll slip, `slip_not_active` for a draft slip) and verify `gateway.test.ts` "unknown slip id" and "slip not yet signed"
- [x] 2.3 Build the `metered_charge` proposal in `metering.ts` and run the pure guard with spent = settled spent + unsettled meters; on `within` write the meter plus `guard.verdict` (via `appendVerdictEvent`) and `toll-road.metered` (running totals) and verify `gateway.test.ts` "paid fetch" (200, charged $0.02, remaining $0.13, mock rail call log unchanged)
- [x] 2.4 Verify `gateway.test.ts` "metering sums": fetches at $0.02, $0.04, $0.05, $0.02 leave 4 meters summing to $0.13 and the last metered event reports $0.02 remaining
- [x] 2.5 Map refusals by clause kind (expired, then cap, then budget, else `needs_review`) and append `guard.verdict` plus `toll-road.refused`; verify `gateway.test.ts` "402 when budget exhausted", "price above cap rejected", "slip expired" and "maps violations to reasons with expiry first, then cap, then budget"
- [x] 2.6 Serve repeat fetches free (`charged` 0.00, `alreadyPaid: true`, no new meter) and verify `gateway.test.ts` "second fetch of the same article is not charged"
- [x] 2.7 Verify `gateway.test.ts` "concurrent fetches with room for one": two $0.04 fetches through `Promise.all` with $0.05 left give exactly one 200 and one 402 `budget_exhausted`

## 3. HTTP routes

- [x] 3.1 Implement `src/app/api/p/toll-road/content/[id]/route.ts` (GET, thin wrapper over `handleGatewayGet` in `server.ts`, `Cache-Control: no-store`) and verify `routes.test.ts` "GET without header returns 402 with WWW-Authenticate", "GET with an active toll slip returns the article" and "GET unknown content returns 404"
- [x] 3.2 Implement `src/app/api/p/toll-road/content/route.ts` (POST registration, GET price list) and verify `routes.test.ts` "valid registration returns 201 with gateway URL", "bad price returns 400 naming price" and "catalog lists prices without bodies or payout emails"

## 4. Toll slip compile and signing

- [x] 4.1 Write the compiler mock in `slip.ts` (first dollar amount is the budget, cents or second amount is the cap, defaults $0.15, $0.05, 60 minutes) plus the rate-card safety net, and verify `slip.test.ts` "default intent compiles to budget_max 0.15, rate_card fetch 0.05, expires_at +60m", "reads other amounts and durations" and "adds a rate card when a live compiler leaves it out"
- [x] 4.2 Implement steps `setup`, `compile`, `sign`, `activate` in `index.ts` with the `user_confirm` and `paypal_approval` waits and verify `pipeline.test.ts` "run waits on user_confirm, then paypal_approval, then the slip is active"
- [x] 4.3 Handle declines and verify `pipeline.test.ts` "confirmed false ends declined with slip rejected and no order" and "approved false ends not_signed with slip rejected"

## 5. Quarantined reader and crawler

- [x] 5.1 Implement `reader.ts` (no-tool `ai.json`, fast tier, schema of up to 5 key points plus `injectionSuspected`, seeded notes or heuristic mock, scrubber for live output) and verify `reader.test.ts` "tw-2 is flagged and its notes contain no instruction text"
- [x] 5.2 Implement the `list_catalog`, `fetch_article` and `finish` tools in `crawler.ts` with the slip id bound in the closure, `fetch_article` input limited to `{ contentId }`, and a `toll-road.injection_flagged` event when the reader flags a page; verify `crawler.test.ts` "fetch_article ignores a slipId field in its input" and "returns notes, not article text"
- [x] 5.3 Add the stop latch after `budget_exhausted` or `slip_expired` and verify `crawler.test.ts` "fetch after the stop returns the stop result without a gateway call or ledger event" and "price_above_cap does not stop the crawl"
- [x] 5.4 Filter `finish` citations to paid content and verify `crawler.test.ts` "citation of unpaid content is dropped"
- [x] 5.5 Implement the `crawl` step with the mock script and `TOLL_ROAD_MOCK_DELAY_MS` and verify `pipeline.test.ts` "mock crawl pays 4, refuses 2, stops on budget_exhausted and asks for a new slip"

## 6. Settlement

- [x] 6.1 Build the purchase proposal in `settlement.ts` with one item per publisher and price and verify `settlement.test.ts` "items sum to the meter total and every unitPrice is within the cap"
- [x] 6.2 Implement the `settle` step (`settlePurchase` with final capture, `releaseRemainder`, meters marked settled, `toll-road.settled` event) and verify `pipeline.test.ts` "settlement capture equals meter total" (one $0.13 capture in the mock rail call log)
- [x] 6.3 Handle zero meters and verify `pipeline.test.ts` "no meters ends nothing_to_settle with the authorization voided and no capture"
- [x] 6.4 Handle failures and verify `pipeline.test.ts` "expired slip at settlement voids and fails with no payout" and "capture error fails with meters unsettled"

## 7. Publisher payout

- [x] 7.1 Implement the largest-remainder split (ties by publisher id) and verify `settlement.test.ts` "publisher split weights sum to 10000 and match usage" ($0.04 / $0.04 / $0.05 gives 3077 / 3077 / 3846, plus 200 random usage vectors that always sum to 10000 and stay within 1 bp of the exact share, plus a tie case)
- [x] 7.2 Implement the `payout` step (network payout slip with `budget_max`, `split_rule`, `payee_allowlist`, `expires_at`; marked active with a `slip.status` event; `settlePayout`; `toll-road.payout_split` event) and verify `pipeline.test.ts` "payout batch pays $0.04, $0.04 and $0.05 to the three publisher emails" and `settlement.test.ts` "network slip carries budget, split, allowlist and expiry"
- [x] 7.3 Verify `settlement.test.ts` "payee outside the allowlist gets an outside verdict and no batch" and "the honest payout passes the guard"
- [x] 7.4 Verify `pipeline.test.ts` "full mock run": start, resume `user_confirm` with `approved: true`, approve on the mock rail, resume `paypal_approval` true; run is done with outcome "paid", capture equals meter total, payout items sum to it, both slip chains verify

## 8. Toll Road page

- [x] 8.1 Implement `src/pipelines/toll-road/counters.ts` (ledger events to paid, refused, spent, remaining, per-publisher earnings, stamps with injection flags) and verify `counters.test.ts` "mock event sequence ends at 4 paid, 2 refused, $0.13 spent, $0.02 remaining" and "partial streams count what has arrived so far"
- [x] 8.2 Build `src/app/p/toll-road/page.tsx` (server, seeds and reads the catalog) and `toll-road-view.tsx` (client: publisher cards with prices and live earnings, start form, `WaitPanel`) and verify the typecheck grep prints nothing
- [x] 8.3 Add `raw-402-panel.tsx` (real same-origin GET without the header, status line, headers, JSON body, curl line) and verify the typecheck grep prints nothing
- [x] 8.4 Add the activity stream with per-fetch stamps in an `aria-live="polite"` region, the counters, the answer card with the "sign a new slip" prompt, the publisher split table, `SlipCard` for both slips and `LedgerTimeline` for both chains, and verify the typecheck grep and the eslint check are clean

## 9. Integration checks

- [x] 9.1 Run `npx vitest run src/pipelines/toll-road` and verify every test passes
- [x] 9.2 Run the typecheck grep and the eslint check and verify both are clean
- [x] 9.3 Run `openspec validate add-toll-road-pipeline --strict` and verify it reports the change as valid
- [ ] 9.4 Integration stage (dev server owned by the integration agent): `curl -i http://localhost:3000/api/p/toll-road/content/tw-1` prints `402` and the `WWW-Authenticate` header, and a mock run on `/p/toll-road` matches the demo beat in design.md
