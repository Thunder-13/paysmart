# Tasks

Checks used below: `npx vitest run <file>`; `npm run -s typecheck 2>&1 | grep -E "src/(pipelines|app/p|app/api/p)/shop"` must print nothing ("shop typecheck clean"). Tests build runtimes with `createTestRuntime()` from `@/core/testing` and a fixed clock `2026-11-08T18:00:00Z` (a Sunday) unless a task says otherwise.

## 1. Types and scaffolding

- [x] 1.1 Create `src/pipelines/shop/types.ts`: `ShopInputSchema` (intent defaulting to the demo intent, principal, `redTeam` false, `hireHelper` false), `ShopState`, `Outcome`, `Listing`, `Attestation`, and zod schemas for every resume signal (confirm_slip, complete_signing, confirm_cart, verify_delivery, confirm_refund); verify shop typecheck clean.

## 2. Catalog

- [x] 2.1 Write `src/pipelines/shop/fixtures.ts` with the 8 fixture listings, the 2 planted red-team listings, clock-relative delivery estimates, mock extractor facts per listing and the demo intent; verify `npx vitest run src/pipelines/shop/fixtures.test.ts` passes (8 catalog items, at least 2 `battery`, exactly 1 with itemCount 4, Clockwork Rex $42.18 arriving on or before the c4 date for a Sunday clock and a Friday clock, late items after it).
- [x] 2.2 Write `src/pipelines/shop/channel3.ts` (injectable `fetch`, 10 s timeout, lenient response schema, cheapest in-stock offer, Money through integer cents, no images); verify `npx vitest run src/pipelines/shop/channel3.test.ts` passes (URL, `x-api-key` header, body with `limit` clamped to 30, `filters.price.max`, `availability: ["InStock"]`, `config.mode: "agentic"`, price 42.18 maps to `{ currency: "USD", value: "42.18" }`, HTTP 500 throws a typed error).
- [x] 2.3 Write `src/pipelines/shop/catalog.ts` (Channel3 when `CHANNEL3_API_KEY` is set, fixtures otherwise, price cap at the remaining budget, red-team planting, no fixture fallback on error); verify `npx vitest run src/pipelines/shop/catalog.test.ts` passes (bundle first only in red-team mode, gift card only on "gift card" or "dino mega" queries, Channel3 failure surfaces as an error with zero listings).
- [x] 2.4 Write `scripts/shop-make-sample-photo.ts` (PNG via `node:zlib`: toy outline plus a battery pack) that writes `src/pipelines/shop/sample-photo.ts` exporting base64; verify `npx tsx scripts/shop-make-sample-photo.ts` runs and `npx vitest run src/pipelines/shop/fixtures.test.ts` checks the PNG signature and a size under 40 KB.

## 3. Compile, confirm and sign

- [x] 3.1 Write `src/pipelines/shop/compile.ts`: compiler guidance text, deterministic mock returning c1 to c6 from `now()`, `validateClauseEdits` (schema, exactly one positive `budget_max`, ids kept) and budget sync; verify `npx vitest run src/pipelines/shop/compile.test.ts` passes (6 clauses in order, c4 is the next Saturday, c6 is 72 hours out, two budgets rejected, malformed clause rejected).
- [x] 3.2 Implement steps `intake`, `compile`, `confirm_slip`, `sign`, `complete_signing` in `src/pipelines/shop/steps.ts`; verify `npx vitest run src/pipelines/shop/steps.signing.test.ts` passes (demo intent waits with 6 clauses; c1 edited to $50.00 gives a $50.00 order and a `shop.clauses_edited` event with actor `user`; reject gives outcome `cancelled` and no order; PayPal cancel gives slip `rejected`; `vi.spyOn(runtime.rail, "authorizeOrder")` rejecting makes the run fail and the agent never runs).

## 4. Shopping agent and guard

- [x] 4.1 Implement `search_products` and `inspect_listing` in `src/pipelines/shop/tools.ts` with the per-run listing cache, `detectInjection` OR-ed into `injectionSuspected`, and `shop.search` / `shop.listing_inspected` ledger events; verify `npx vitest run src/pipelines/shop/tools.test.ts` passes (unknown id refused, bundle flagged even when the extractor mock says false, Clockwork Rex facts `wind_up` and toy).
- [x] 4.2 Implement `propose_cart` (ids and quantities only, auto-inspect, amount via `@/core/money`, `core.evaluate`, 3-proposal limit, latest WITHIN or ASK cart kept); verify `tools.test.ts` passes (forged id leaves the count unchanged, 4th call refused without a `guard.verdict` event, no proposal item carries description text).
- [x] 4.3 Write `src/pipelines/shop/agent.ts` (system prompt, task builder, mock scripts for the 4 flag combinations); verify `npx vitest run src/pipelines/shop/redteam.test.ts` passes: first proposal is 4 bundles plus the gift card at $419.96 with decision `outside` citing c1, c2 and `integrity`; second proposal is Clockwork Rex at $42.18 with decision `within`.
- [x] 4.4 Implement the `shop` step (runAgent wiring, `agent.step` events for messages, no-cart path that releases and finishes `no_cart`, cart wait payload with totals); verify `npx vitest run src/pipelines/shop/steps.shop.test.ts` passes (red-team run waits on confirm_cart with capture $42.18 and release $17.82; a script with 3 OUTSIDE proposals ends `no_cart` with the authorization voided).

## 5. Hire-a-helper child slips

- [x] 5.1 Write `src/pipelines/shop/helper.ts` and the `hire_helper` tool (child slip with 4 clauses, `ai.text` fast helper, `ai.json` fast judge, `work_product` evidence, release on fail, parent ledger events); verify `npx vitest run src/pipelines/shop/helper.test.ts` passes (child budget $3.00 nested under the parent, parent remaining budget $57.00 while open, failing judge gives evidence `fail`, child released and no payout).
- [x] 5.2 Add the allowlist abuse case; verify `helper.test.ts` passes a test where `core.settlePayout` on the child to a different email returns `outside` citing the allowlist clause and no `rail.payout_created` event exists.

## 6. Cart confirmation and settlement

- [x] 6.1 Implement `confirm_cart` (approve, decline with child and parent release, ASK attestations recorded as `shop.attested` with actor `user` then re-evaluated); verify `npx vitest run src/pipelines/shop/steps.settle.test.ts` passes the decline case (authorization voided, nothing captured, outcome `cancelled`) and the ASK case (no attestation re-waits; attested date makes it `within`).
- [x] 6.2 Implement `settle` (pre-flight evaluate, payout before capture, one final capture, `releaseRemainder`, capture-error void, expired-slip block); verify `steps.settle.test.ts` passes: no helper captures $42.18 and releases $17.82; helper on pays $3.00, captures $45.18 and releases $14.82 (helper payout plus capture recovery); `vi.spyOn(runtime.rail, "captureAuthorization")` rejecting ends `capture_failed` with the authorization voided; a clock past c6 ends `blocked`.

## 7. Delivery check and refund

- [x] 7.1 Write `src/pipelines/shop/delivery.ts` (DeliveryCheck schema, prompt from clauses and item facts only, mock keyed on the sample photo); verify `npx vitest run src/pipelines/shop/delivery.test.ts` passes (prompt contains c5's label and the item facts and none of the listing description).
- [x] 7.2 Implement `verify_delivery`, `confirm_refund` and `refund` (goods-only refund, evidence pack in state); verify `npx vitest run src/pipelines/shop/steps.delivery.test.ts` passes (sample photo gives a c5 breach, `delivery_photo` evidence with "breaks c5" in its detail lands before the refund, refund $42.18, slip `refunded`, evidence pack with chain ok; custom photo in mock mode ends `settled`; low confidence waits; `vi.spyOn(runtime.rail, "refundCapture")` rejecting fails the run with the error text).

## 8. Pipeline definition

- [x] 8.1 Replace the stub in `src/pipelines/shop/index.ts` with the full `PipelineDefinition` (title, tagline, primitives badges, input, initialState, `firstStep: "intake"`, steps); verify shop typecheck clean.
- [x] 8.2 Write the end-to-end test `src/pipelines/shop/shop.e2e.test.ts` driving `runtime.orchestrator.start("shop", { redTeam: true })` through every wait (`mockRail.approveOrder`, approvals, `{ sample: true }`); verify `npx vitest run src/pipelines/shop/shop.e2e.test.ts` passes (Held $60.00, OUTSIDE citing c2 and integrity, WITHIN, captured $42.18, released $17.82, refunded $42.18, `verifyChain` ok, outcome `refunded`) plus a helper-on variant ending with captured $45.18 and a nested child slip `settled`.

## 9. Voice add-on

- [x] 9.1 Write `src/pipelines/shop/voice.ts` (`matchVoiceCommand`, `speakMoney`, `slipUtterances`, `verdictUtterance`, `cartUtterance`, `detectSpeechSupport(win)`); verify `npx vitest run src/pipelines/shop/voice.test.ts` passes ("yes, approve cart" and "Approve the cart." approve; "don't approve the cart" and "approve" alone return null; "cancel the cart" rejects; $42.18 reads "42 dollars and 18 cents"; 6-clause slip gives 7 utterances; OUTSIDE verdict text names clause 2's label and integrity; missing APIs detected as unsupported).
- [x] 9.2 Write `src/app/p/shop/voice-controls.tsx` (dictation into the intent box, read slip, read-aloud toggle for new verdicts, one-shot "Listen for approval" enabled only on confirm_cart, polite `aria-live` status, disabled controls with a note when unsupported, no binding on the PayPal button); verify shop typecheck clean and `npx eslint src/app/p/shop` prints no errors.

## 10. Console page and routes

- [x] 10.1 Write `src/pipelines/shop/api.ts` (`listChildren(runtime, slipId)`, `readPhoto(runtime, ref)` allowing image content types only) and thin routes `src/app/api/p/shop/children/route.ts` and `src/app/api/p/shop/photo/route.ts`; verify `npx vitest run src/pipelines/shop/api.test.ts` passes (children of a helper run, non-image blob refused).
- [x] 10.2 Write `src/pipelines/shop/activity.ts` mapping ledger events to activity cards (search, inspection with the hidden-instructions flag, verdict stamp with cited clause labels, helper card, attestation); verify `npx vitest run src/pipelines/shop/activity.test.ts` passes on the events of a red-team mock run.
- [x] 10.3 Write `src/app/p/shop/page.tsx` and its client components (start form with intent, red-team and helper toggles; left SlipCard with nested child slips; center activity stream and WaitPanels including clause editor, SignWithPayPal, cart approval, FileDrop plus "Use sample photo", EvidencePackView; right LedgerTimeline with Held, Spent, Released, Refunded; `aria-live` verdict region; no retailer images; paper-slip colors); verify shop typecheck clean and `npx eslint src/app/p/shop src/app/api/p/shop` prints no errors.

## 11. Integration checks

- [x] 11.1 Write `scripts/shop-smoke.ts` (flags `--red-team`, `--helper`) that runs the mock pipeline end to end and prints the ledger totals; verify `npx tsx scripts/shop-smoke.ts --red-team` prints Held 60.00, Captured 42.18, Released 17.82, Refunded 42.18 and `npx tsx scripts/shop-smoke.ts --red-team --helper` prints Captured 45.18, Released 14.82.
- [x] 11.2 Run the full worker checks: `npx vitest run src/pipelines/shop` passes, shop typecheck clean, `openspec validate add-shop-pipeline --strict` reports valid.
