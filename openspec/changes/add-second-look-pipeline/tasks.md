# Tasks

All paths are under `src/pipelines/second-look/` unless stated. Tests are vitest files next to the code and build runtimes with `createTestRuntime()` from `@/core/testing`.

## 1. Taxonomy, detectors and fixtures

- [x] 1.1 Add `taxonomy.ts` with `TACTIC_IDS` (the ten ids), plain-words labels, detector weights (D2), band thresholds (30, 60) and the carrier list; verify `npm run -s typecheck 2>&1 | grep -E "second-look"` prints nothing
- [x] 1.2 Add `detectors.ts` (word-boundary regexes, one finding per tactic, quote = full matched line) and `detectors.test.ts`; verify the test "maps each listed phrase to its tactic" covers friends and family, F&F, gift card, crypto, wire, Zelle, "today only", "deposit first", and the test "does not flag wireless" passes
- [x] 1.3 Add `fixtures.ts` with three original conversations (`scam`, `legit`, `borderline`), each with chat text, listing text, seller email and amount; verify `detectors.test.ts` "scam fixture lines trigger ff_request and urgency" passes and the legit fixture contains the word "wireless"

## 2. Analysis

- [x] 2.1 Add `prompt.ts` (hardened system prompt, tagged user prompt, closing-tag stripping) and `prompt.test.ts`; verify "strips closing tags from untrusted text" and "system prompt states content is data" pass
- [x] 2.2 Add `mock.ts` (fixture match by containment, heuristic fallback); verify `analyze.test.ts` "mock is deterministic for the same input" passes
- [x] 2.3 Add `analyze.ts` (`analyzeConversation({ ai, blobs, input })`: detectors, `ai.json` smart tier with the zod schema, quote check, union with `source`, floor, band, injection note via `detectInjection`); verify `analyze.test.ts` "detects tactics on the three fixtures" passes: scam flags `ff_request` and `urgency` with band `high`, legit is `low` without `ff_request`, borderline is `caution`
- [x] 2.4 Add the injection tests to `analyze.test.ts`; verify "injection text in a chat does not change behavior" (scam plus injection lines keeps `ff_request` and `urgency`, score not lower, injection note set) and "hijacked model output keeps detector findings and the 60 floor" (fake AI returns score 0, no tactics) pass
- [x] 2.5 Add the quote check test; verify `analyze.test.ts` "drops a model tactic whose quote is not in the content" passes
- [x] 2.6 Add screenshot handling (blob to `ImageInput`, transcript used by detectors and quote check, skip with note for missing, non-image or over 5 MB blobs); verify `analyze.test.ts` "screenshot-only run passes one image and quotes the transcript" and "PDF blob is skipped with a note" pass

## 3. Slip, offer, family and hand-off modules

- [x] 3.1 Add `slip.ts` (`buildSlip(input, now)` with c1 `payee_allowlist`, c2 `budget_max`, c3 `require_evidence` tracking, c4 `expires_at` now+72h, emails lower-cased); verify `slip.test.ts` "builds exactly the four clauses" passes
- [x] 3.2 Add `offer.ts` (honest-offer and walk-away templates); verify `offer.test.ts` "honest offer contains the goods and services line, amount and seller email" passes
- [x] 3.3 Add `family.ts` (`writeAlert`, `listAlerts` on collection `second-look/alerts`, dedupe per run and reason); verify `family.test.ts` "writes one alert per run and reason" and "writes nothing without a trusted contact" pass
- [x] 3.4 Add `handoff.ts` (`recordHandoff`, `getHandoff` on collection `second-look/handoffs`, id = capture id, `second-look.handoff_created` ledger event, reject without capture); verify `handoff.test.ts` "second report returns the same record" and "rejects a run without a capture" pass

## 4. Pipeline definition and step graph

- [x] 4.1 Replace the stub `index.ts` with the definition: input schema (refine: chat or screenshot required, amount > 0, emails valid), `initialState`, `firstStep: "analyze"`, primitives badges; verify `pipeline.test.ts` "rejects input without chat or screenshot", "rejects a zero amount" and "rejects a malformed email" pass
- [x] 4.2 Implement `analyze`, `compile` and `offer_decision` (slip creation, `second-look.analyzed` event, high-risk alert, user_confirm wait, walk away closes the slip as rejected); verify `pipeline.test.ts` "scam run waits on user_confirm with a draft slip and a high_risk alert" and "walk away ends buyer_walked_away with no order" pass
- [x] 4.3 Implement `seller_decision` (accept with optional `payeeEmail`, refuse with walk-away recommendation and `seller_refused` alert); verify `pipeline.test.ts` "seller-refused path ends seller_refused, alerts family, creates no order" passes
- [x] 4.4 Implement `guard_payment` (payment proposal with pending tracking evidence, block on any non-c3 violation); verify `pipeline.test.ts` "payee allowlist violation when the payee email differs" (guard.verdict outside on c1, outcome `payee_blocked`, no order) and "expired slip ends blocked" pass
- [x] 4.5 Implement `sign` and `capture` (`core.beginSigning` CAPTURE with payee email, `paypal_approval` wait, order id match, `core.completeSigning`, capture id into state); verify `pipeline.test.ts` "approval with a forged order id stays waiting" and "approved:false ends payment_cancelled" pass
- [x] 4.6 Implement `shipment` (shipped: `rail.addTracking`, `rail.tracking_added` event, tracking evidence pass; tracking error: evidence unknown, `shipped_unconfirmed`; not arrived: `recordHandoff`, `handed_off`); verify `pipeline.test.ts` "protected payment mock flow end to end" passes: legit fixture, send offer, seller accepts, `mockRail.approveOrder`, resume approved, shipped with USPS tracking, outcome `protected_shipped`, slip has a capture id and tracking evidence pass, `ledger.verifyChain` ok
- [x] 4.7 Add failure-path tests; verify `pipeline.test.ts` "tracking rejected by PayPal ends shipped_unconfirmed", "not_arrived writes a hand-off keyed by capture id" and "PayPal order error fails the run with the seller email in the message" (spy on `rail.createOrder` to throw) pass
- [x] 4.8 Add resume-validation and replay tests; verify `pipeline.test.ts` "bad seller payload keeps the run waiting" and "same fixture and clock give identical analysis" pass

## 5. Pipeline API routes

- [x] 5.1 Add `src/app/api/p/second-look/alerts/route.ts` (GET `?to=`, newest first, uses `getRuntime()` and `listAlerts`); verify `npm run -s typecheck 2>&1 | grep -E "second-look"` prints nothing
- [x] 5.2 Add `src/app/api/p/second-look/handoff/route.ts` (POST `{ runId }` returns the record or 409 without a capture, GET `?runId=`), reusing `recordHandoff`; verify typecheck as in 5.1 and that `handoff.test.ts` still passes

## 6. Second Look page

- [x] 6.1 Add `src/app/p/second-look/page.tsx` (server component, passes `SECOND_LOOK_SELLER_EMAIL` prefill in sandbox mode) and `second-look-client.tsx` with the input form (labels on every field, FileDrop to `/api/blobs`, three sample buttons) calling `startRun`; verify typecheck as in 5.1
- [x] 6.2 Add a pure `highlight.ts` (split chat into segments marking normalized quote matches) used by the chat view, plus the risk meter, band colors and tactic chips; verify `highlight.test.ts` "marks every scam fixture quote" passes
- [x] 6.3 Render each wait with `useRun`/`resumeRun`: risk card with honest offer and copy control, "Seller accepted protected payment" and "Seller refused" demo buttons, `SignWithPayPal` for `paypal_approval`, tracking form with the carrier list, "Item never arrived" (resume while waiting, POST route after done); verify typecheck as in 5.1
- [x] 6.4 Add `SlipCard`, `VerdictStamp`, `LedgerTimeline` and the family inbox panel (GET alerts route), with an `aria-live` region for verdicts and risk changes and "PayPal" only on PayPal actions; verify typecheck as in 5.1 and `grep -n "PayPal" src/app/p/second-look/*.tsx` shows only PayPal action labels

## 7. Smoke script and integration checks

- [x] 7.1 Add `scripts/second-look-smoke.ts` that runs every mock path (protected_shipped, seller_refused, payee_blocked, buyer_walked_away, handed_off) on a test runtime and prints one line per outcome; verify `npx tsx scripts/second-look-smoke.ts` exits 0 and prints all five outcomes
- [x] 7.2 Run the worker checks; verify `npx vitest run src/pipelines/second-look` passes, `npm run -s typecheck 2>&1 | grep -E "second-look"` prints nothing, and `openspec validate add-second-look-pipeline --strict` reports the change valid
- [ ] 7.3 With sandbox keys, create a CAPTURE order with `payee.email_address` set to a personal sandbox account, approve and capture it, then try tracking on the capture; record the result (works, or fallback to a sandbox business seller) under "Real sandbox notes" in this change's `design.md`
