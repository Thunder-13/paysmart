# Tasks

Shared checks: `npx vitest run src/pipelines/bounty`, and `npm run -s typecheck 2>&1 | grep -E "src/(pipelines|app/p|app/api/p)/bounty|scripts/bounty-"` must print nothing.

## 1. Schemas and pure helpers

- [x] 1.1 Write `src/pipelines/bounty/schema.ts`: `BountyPipelineInput` (discriminated on `kind`), bounty-run signal union (on `event`), pledge-run signal, run state union, `Bounty` and `ProofRow` types. Verify with `schema.test.ts` "parses both input kinds and every signal, rejects unknown events".
- [x] 1.2 Write `src/pipelines/bounty/dhash.ts` (`dHashFromGray`, `hamming`, `isNearDuplicate` at distance 5 or less). Verify with `dhash.test.ts` "dHash Hamming function": identical hashes give 0, `0000000000000000` vs `000000000000000f` gives 4, complements give 64, non-hex input throws, a known 9x8 grid gives its expected hash.
- [x] 1.3 Write `src/pipelines/bounty/checks.ts` (`freshPhotos`, `timing`, `location` with haversine). Verify with `checks.test.ts`: same image fails, distance 3 vs a stored row fails and names its bounty, distance 6 passes, equal SHA-256 fails, photo before claim fails, before later than after fails, 3 minutes in the future fails, 2 km off a 150 m radius fails, missing coordinates gives "not checked" without failing.
- [x] 1.4 Write `src/pipelines/bounty/allocate.ts`. Verify with `allocate.test.ts`: 25.00 + 15.00 on 40.00 allocates both in full; 30.00 + 10.00 + 10.00 on 40.00 gives the last pledge 0.00; ties break on slip id.
- [x] 1.5 Write `scripts/bounty-fixtures.ts` and generate `src/pipelines/bounty/fixtures.ts` (passing pair, duplicate pair, PNGs under 1 KB each). Verify with `npx tsx scripts/bounty-fixtures.ts` and `fixtures.test.ts`: passing pair is more than 5 bits apart, duplicate pair 5 or fewer, every base64 decodes to a PNG signature.

## 2. AI calls

- [x] 2.1 Write `draftBounty` in `src/pipelines/bounty/ai.ts` (`ai.json` fast, label `bounty.draft`, no tools, deterministic keyword mock). Verify with `ai.test.ts`: the mock returns 2 to 5 checks and both shot instructions for a drain title and for a generic title.
- [x] 2.2 Write `verifyProof` and the pure `gradeResults` in `ai.ts` (`ai.json` smart, label `bounty.verify`, both images, all-pass mock). Verify with `ai.test.ts`: a model output that drops a check id grades that check as failed, and overall pass needs every drafted check.

## 3. Pledge run

- [x] 3.1 Write steps `route`, `pledge_start` and `pledge_signed` in `src/pipelines/bounty/steps/pledge.ts` (createSlip, beginSigning AUTHORIZE, completeSigning, releaseRemainder on a closed bounty). Verify with `pledge.test.ts` "approved pledge holds money": slip `active`, authorization id set, no capture ids.
- [x] 3.2 Add the remainder clamp and refusal paths. Verify with `pledge.test.ts`: 25.00 asked with 10.00 uncovered creates a 10.00 slip and order; a covered bounty and an expired bounty both fail with no slip created.
- [x] 3.3 Add the decline and late-approval paths. Verify with `pledge.test.ts`: mock rail `cancelOrder` leaves the slip `rejected` and funding unchanged; approval after cancel ends the slip `released` with a `rail.voided` ledger event.

## 4. Bounty run: draft, funding, claim

- [x] 4.1 Write the `draft` step (range checks, AI draft, payout slip with `c1 budget_max`, `c2 require_evidence`, `c3 expires_at`, bounty record, `bounty.created`). Verify with `lifecycle.test.ts` "creates a payout slip with 3 clauses and no order", "out-of-range input fails with no slip", and "injected description keeps the 3 clauses".
- [x] 4.2 Write the `funding` step (sum of `active` pledge slips, payout slip to `active`, `bounty.funded`, deadline and cancel guard). Verify with `lifecycle.test.ts` "2 backers cover the reward", "unsigned pledge does not count", and "a tick recomputes funding after a lost nudge".
- [x] 4.3 Write the `claim` step (zod email, append `c4 payee_allowlist`, `bounty.claimed`, wait `user_upload`). Verify with `lifecycle.test.ts` "claim adds payee allowlist", "claim before funding is rejected", "second claim is rejected", "malformed email is rejected" (each checks the clause list is unchanged on rejection).

## 5. Proof verification

- [x] 5.1 Write the `verify` step: validate the submission, load blobs, SHA-256 with `node:crypto`, store `proofs` rows, run `freshPhotos`, `timing`, `location`, call `verifyProof` only when they pass, `addEvidence` on the payout slip and each pledge on a pass. Verify with `lifecycle.test.ts` "duplicate photo rejected" (spy on `ai.json` shows no `bounty.verify` call, run still waits `user_upload`).
- [x] 5.2 Cover the other verify paths. Verify with `lifecycle.test.ts`: "near duplicate of an earlier bounty's proof is rejected", "missing blob or malformed dHash is refused before checks", "photo outside the job radius is rejected", "a failed rubric check keeps pledges held and waits for new photos", "passing pair adds before_after_photos pass evidence to every slip".

## 6. Settlement, receipt and close

- [x] 6.1 Write `settle` and `receipt` (allocate, settlePurchase with `finalCapture: true`, releaseRemainder for 0 allocations, settlePayout, `rail.getPayout`). Verify with `lifecycle.test.ts` "full mock lifecycle with 2 backers": both pledges captured in full, 1 payout batch of 40.00 to the worker, payout and pledge slips `settled`, bounty `paid`.
- [x] 6.2 Add over-pledge trimming. Verify with `settle.test.ts` "race for the last 10.00 captures the first and voids the second".
- [x] 6.3 Add the capture-failure path (refund captures, release the rest, `settle_failed`). Verify with `settle.test.ts`, using `vi.spyOn(rail, "captureAuthorization")` to reject the second call: first capture refunded, second voided, no payout batch.
- [x] 6.4 Add the payout-failure path (wait `user_confirm`, `payout_retry`, `payout_refund`, no second batch). Verify with `settle.test.ts`: a rejected `createPayout` leaves the run waiting; retry creates exactly 1 batch; refund marks the bounty `refunded`.
- [x] 6.5 Verify guard blocking with `guard.test.ts` "payout blocked when evidence missing (guard ask/outside)": `core.settlePayout` with no evidence returns a verdict other than `within` and a null batch id; plus "payout to a different email is outside on payee_allowlist" and "payout above the reward is outside on budget_max".
- [x] 6.6 Write the `close` step and the deadline and cancel checks in every waiting step. Verify with `lifecycle.test.ts` "deadline expiry voids pledges" (test clock from `createTestRuntime({ now })` moved past the deadline, then a `tick`): both authorizations voided, pledge slips `released`, payout slip `expired`, no capture or payout; plus "organizer cancels a claimed bounty" and "repeated close is a no-op".
- [x] 6.7 Verify the ledger with `lifecycle.test.ts` "ledger after a paid bounty": event order matches the spec and `ledger.verifyChain(payoutSlipId).ok` is true.
- [x] 6.8 Replace the stub in `src/pipelines/bounty/index.ts` with the full definition (title, tagline, primitives, input, initialState, `firstStep: "route"`, steps). Verify with `npx vitest run src/pipelines/bounty` and the typecheck grep printing nothing.

## 7. API and UI

- [x] 7.1 Write `buildBoard(runtime)` in `src/pipelines/bounty/board.ts` and `GET` in `src/app/api/p/bounty/route.ts`. Verify with `board.test.ts`: after 1 pledge of 25.00 on a 40.00 bounty the board entry shows funded 25.00, 1 pledge, and the run's wait.
- [x] 7.2 Write `src/app/p/bounty/page.tsx` and `board.tsx` (cards, funded bar with `aria-valuenow` and text label, create form, back flow with `SignWithPayPal`, pledge nudge on return, claim form, cancel). Verify with the typecheck grep and `grep -n "aria-valuenow" src/app/p/bounty/*.tsx`.
- [x] 7.3 Write `proof-capture.tsx` (2 camera inputs, `FileDrop` fallback, 1280 px downscale, dHash from a 9x8 canvas through `dHashFromGray`, upload to `/api/blobs`, optional geolocation). Verify with `grep -n 'capture="environment"' src/app/p/bounty/proof-capture.tsx` (1 input per photo slot, 2 slots rendered) and the typecheck grep.
- [x] 7.4 Write `checklist.tsx` (rows with reasons in `aria-live="polite"`, `VerdictStamp`) and `receipt.tsx` (batch id, PayPal status, worker, per-backer captures), and render `SlipCard` for the payout slip and pledges plus `LedgerTimeline`. Verify with the typecheck grep and `grep -n 'aria-live' src/app/p/bounty/checklist.tsx`.

## 8. Scripts

- [x] 8.1 Write `tickAll(runtime)` in `src/pipelines/bounty/tick.ts` (resume every waiting bounty run with `{ event: "tick" }`, return how many closed) and `scripts/bounty-tick.ts` that calls it with `getRuntime()` and prints the count. Verify with `lifecycle.test.ts` "tick closes only past-deadline bounties".
- [x] 8.2 Write `scripts/bounty-smoke.ts` (mock runtime, full lifecycle, prints the ledger and receipt). Verify with `npx tsx scripts/bounty-smoke.ts` exiting 0 and printing `bounty.paid`.

## 9. Integration checks

- [x] 9.1 Run `npx vitest run src/pipelines/bounty` and confirm every test passes.
- [x] 9.2 Run the typecheck grep and confirm it prints nothing.
- [x] 9.3 Run `openspec validate add-bounty-pipeline --strict` and confirm it passes.
- [ ] 9.4 With sandbox keys set, run 1 bounty with a 1.00 USD reward end to end and write the Payouts result (batch status, item status) into the "Real sandbox notes" section of design.md.
