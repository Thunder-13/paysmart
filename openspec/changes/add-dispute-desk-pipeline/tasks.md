# Tasks

Test files live next to the code in `src/pipelines/dispute-desk/`. Every test builds its runtime with `createTestRuntime()` from `@/core/testing` (mock rail, scripted AI). "Typecheck clean" means `npm run -s typecheck 2>&1 | grep -E "dispute-desk"` prints nothing.

## 1. Types and schemas

- [x] 1.1 Write `types.ts` with `DisputeDeskState`, `BuyerClaimSchema`, `RecommendationSchema`, `ResumeSignalSchema` (notes required for contest and accept, max 2000) and the input schema `{ disputeId: string.min(1) }`; verify with `types.test.ts` "resume signal rejects empty notes for contest and accepts hold with empty notes" and "input rejects empty disputeId", and typecheck clean

## 2. Linking

- [x] 2.1 Implement `linkDispute(store, transactionId)` in `link.ts`: `findByRailId` first, then `collection("second-look","handoffs").get(transactionId)` (record id = captureId) with an `orderId` scan fallback, else `none`; keep the parsed handoff record as display context; verify `link.test.ts` "links by capture id" (slip created with `rail.captureIds = ["CAP-1"]`, dispute transaction id `CAP-1`)
- [x] 2.2 Cover the other link paths; verify `link.test.ts` "links through a second-look handoff record keyed by capture id", "links through a handoff matched on orderId", "keeps handoff tracking as context when findByRailId already linked", "null transaction id links to none" and "handoff naming a missing slip links to none"

## 3. Facts, rules and the honesty floor

- [x] 3.1 Implement `deriveFacts` and the tolerant event-data parsers in `facts.ts`; verify `facts.test.ts` "finds signed, capture, tracking, delivery fail and refund seqs" on a pack built through core APIs, and "an outside verdict before a within verdict and capture is not a breach"
- [x] 3.2 Implement `recommendByRules` (rules 1 to 9 in design.md D1); verify `rules.test.ts` has one case per rule and each asserts decision, confidence and cited seqs
- [x] 3.3 Implement `applyHonestyFloor`; verify `rules.test.ts` "drops seqs and clause ids not in the pack" (cites 3 and 99, c2 and c9 → keeps 3 and c2), "contest with no surviving citation becomes need_more", "model contest with a failed delivery check becomes accept with override", and "alreadyRefunded comes from facts even when the model omits it"
- [x] 3.4 Tampered chain: verify `rules.test.ts` "tampered chain yields no citations and a warning" (pack with `chain = { ok: false, brokenAtSeq: 4 }` → decision need_more, empty `citedSeqs` and `citedClauseIds`, warning text contains "#4")

## 4. Buyer-text quarantine

- [x] 4.1 Implement `readBuyerClaim(ai, dispute)` in `quarantine.ts` (`detectInjection` per message, one no-tool `ai.json` tier fast labelled `dispute-desk.buyer-claim`, reason-code fallback on error); verify `quarantine.test.ts` "flags injection from detectInjection even when the model says false" and "falls back to the reason code when ai.json throws"
- [x] 4.2 Injection is ignored end to end; verify `quarantine.test.ts` "injection text in buyer message is ignored": with `vi.spyOn(ai, "json")` and `vi.spyOn(ai, "text")`, the `dispute-desk.triage` and `dispute-desk.draft` prompts and system texts don't contain the injected sentence, and the recommendation equals the one for the same dispute without it

## 5. Evidence documents and draft

- [x] 5.1 Implement `buildEvidenceDocuments` in `documents.ts` (JSON plus text, base64 UTF-8, sha256 per document, no documents for a broken chain); verify `documents.test.ts` "JSON document decodes and its event hashes equal the ledger's", "sha256 matches the decoded bytes" and "broken chain builds no documents"
- [x] 5.2 Implement the draft prompt builder and `mockDraft` in `draft.ts` (contest, accept, need_more templates; `#seq` references; total notes at most 2000 characters ending in `Evidence pack sha256: <hex>`); verify `draft.test.ts` "contest notes cite seqs and end with the JSON sha256", "notes never exceed 2000 characters with a 5000-character model draft" and "need_more draft lists missing evidence for an unlinked dispute"

## 6. Pipeline steps and definition

- [x] 6.1 Implement `load`, `link` and `pack` in `steps.ts` (run adopts the linked slip id, pack pinned to a blob); verify `pipeline.test.ts` "getDispute error fails the run with no ledger writes" and "linked run carries the slip id and a pinned pack ref"
- [x] 6.2 Implement `triage` (claim, recommendation, floor, `dispute-desk.recommended` event, case record) and `draft` (documents to blobs, wait `user_confirm` with resumeAt `act`); verify `pipeline.test.ts` "run waits for user_confirm with recommendation, notes and document sizes" and "linked slip gains a dispute-desk.recommended event"
- [x] 6.3 Mock-mode scenario outcomes; verify `pipeline.test.ts` "scenario not_received recommends contest citing capture and tracking", "scenario not_as_described recommends accept with already refunded" and "scenario unlinked recommends need_more", each built with a slip history created through core APIs and disputes from `seedDemoDisputes`
- [x] 6.4 Implement `act` for contest; verify `pipeline.test.ts` "provideEvidence payload shape": `vi.spyOn(rail, "provideEvidence")` is called once with `(disputeId, { notes, documents })`, two documents with `name`, `contentType` in `application/json | text/plain` and decodable `base64`, and the slip gains one `rail.dispute_evidence` event whose data holds the dispute id and both sha256 values
- [x] 6.5 Implement `act` for accept; verify `pipeline.test.ts` "acceptClaim path": the merchant switches a contest recommendation to accept, `acceptClaim` is called once with the merchant's notes, `provideEvidence` is never called, and the slip gains one `rail.dispute_accepted` event
- [x] 6.6 Implement the act guards; verify `pipeline.test.ts` "WaitPanel {approved: true} sends the suggested decision with the draft notes", "invalid signal re-waits without PayPal calls", "hold finishes with outcome held and no PayPal writes", "status UNDER_REVIEW at act time ends not_actionable", "provideEvidence error re-waits with the error and appends no ledger event", "broken chain contest sends notes only" and "unlinked contest sends notes only and appends no ledger event"
- [x] 6.7 Replace the stub in `index.ts` with the real `PipelineDefinition` (title "Dispute Desk", tagline, primitives, steps); verify `npx vitest run src/pipelines/dispute-desk` passes and typecheck clean

## 7. Demo seeding

- [x] 7.1 Implement `seedDemoDisputes(runtime, links)` and `ensureFixtureDisputes(runtime)` in `seed.ts` (deterministic ids, amount from the linked slip, due dates from `runtime.now()`); verify `seed.test.ts` "seeds one dispute per link with the scenario reason and capture id", "seeding twice creates nothing new", "fixtures appear once after two board loads" and "sandbox-mode rail creates nothing and says seeding is mock-only"

## 8. Deadline board and API routes

- [x] 8.1 Implement `laneOf`, `urgencyOf`, `reasonLabel` and `buildBoard` in `board.ts`; verify `board.test.ts` "urgency thresholds" (clock 2026-11-10T12:00:00Z → overdue, urgent, soon, ok, none for the five due dates in the spec), "APPEALABLE lands in Other" and "cards sort by due date with undated last"
- [x] 8.2 Add `src/app/api/p/dispute-desk/disputes/route.ts` (GET, mock mode calls `ensureFixtureDisputes` first) and `src/app/api/p/dispute-desk/seed/route.ts` (POST `{ links }`, 409 in sandbox mode), thin wrappers over `api.ts` through `getRuntime()`; verify `routes.test.ts` "GET returns six lanes with fixtures on a fresh runtime", "POST seed links a capture and the board shows the slip link", "POST seed rejects a bad body with 400" and "POST seed returns 409 when the rail is sandbox", calling the route handlers directly with a test runtime injected through `vi.mock("@/server/runtime")`

## 9. Dispute Desk page

- [x] 9.1 Add pure view helpers in `src/pipelines/dispute-desk/view.ts` (`urgencyChip`, `noteState`, `chainStamp`, `outcomeAnnouncement`); verify `view.test.ts` "note state disables send for empty and 2001-character notes", "chain stamp reads Chain verified with the count or Chain broken at #N" and "outcome announcement names the PayPal status and ledger seq"
- [x] 9.2 Build `src/app/p/dispute-desk/page.tsx` (server, `force-dynamic`, empty-board fallback when the rail can't list disputes) and `board-view.tsx` (CSS grid lanes, urgency chip with color and text, keyboard-selectable cards); verify typecheck clean and `grep -rni "bryntum" src/app/p/dispute-desk` prints nothing
- [x] 9.3 Build `dispute-desk-client.tsx`, `recommendation-card.tsx` and `response-editor.tsx` (detail view, quoted untrusted buyer text, `SlipCard` or "No slip found", chain stamp plus `EvidencePackView` of the pinned pack, `#seq` chips that scroll to and focus `ledger-<seq>` through `LedgerTimeline focusSeq`, labelled textarea with `n / 2000`, the three act buttons, `aria-live` region, `startRun` / `resumeRun` / `useRun`, reopen a waiting run from the case record); verify typecheck clean, `npx eslint src/app/p/dispute-desk` has no errors, and `grep -c "aria-live" src/app/p/dispute-desk/dispute-desk-client.tsx` prints at least 1

## 10. Smoke script and integration checks

- [x] 10.1 Write `scripts/dispute-desk-smoke.ts`: builds a test runtime, creates three slip histories, seeds the three scenarios, runs each to the wait, resumes with the recommended decision, and prints dispute id, decision, outcome and ledger seq; verify `npx tsx scripts/dispute-desk-smoke.ts` prints contest, accept and need_more and exits 0
- [x] 10.2 Final checks: `npx vitest run src/pipelines/dispute-desk` passes, typecheck clean, `npx eslint src/pipelines/dispute-desk src/app/p/dispute-desk src/app/api/p/dispute-desk` has no errors, and `openspec validate add-dispute-desk-pipeline --strict` passes
