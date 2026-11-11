# Design: bounty pipeline

## Context

See proposal.md (Why) and specs/bounty-pipeline/spec.md for the behavior contract.

The pipeline builds on the frozen contract in `src/core/contracts.ts` and nothing else from core internals. The constraints that shape the design:

- A `PipelineDefinition` has one `input` schema, one `firstStep`, and steps that return `next`, `wait` (with `resumeAt`), `done` or `fail`. A run waits on one thing at a time.
- `StepContext` gives steps the rail, AI, store, guard and `CoreServices`, but no orchestrator handle. A step can't resume another run.
- The core's PayPal return handler resumes the run waiting on `paypal_approval` with `{ approved, orderId }`. Everything else comes in through `POST /api/runs/[id]/resume`.
- There's no scheduler. Time-based work only happens when something resumes a run.
- Mock mode must run everything end to end with no keys.

## Goals / Non-Goals

**Goals:**

- One bounty run per bounty that owns the lifecycle, plus one short pledge run per backer, both inside the single `bounty` pipeline definition.
- Slips are the source of truth for money. The bounty record only holds what slips can't (rubric, claim, attempts, receipt).
- Every money move goes through a `CoreServices` call so the guard sees it and the ledger records it.
- Proof checks are cheap and deterministic first, with the vision model last.

**Non-Goals:**

- A generic sub-run framework in core. The pledge run is plain bounty-pipeline code.
- Push updates from pledge runs into the bounty run. The bounty run pulls state from slips when it wakes.
- Server-side image processing.

## Decisions

### D1. Two run kinds behind one input discriminator

`input` is a zod discriminated union on `kind`:

```ts
const CreateBountyInput = z.object({
  kind: z.literal("bounty"),
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(1000),
  reward: MoneySchema,                       // USD, 1.00..500.00 (checked in draft)
  deadline: z.string().datetime(),           // now+1h..now+72h (checked in draft)
  location: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().int().min(25).max(2000) }).nullable(),
  organizer: PrincipalSchema,
});
const PledgeInput = z.object({
  kind: z.literal("pledge"),
  bountyId: z.string(),
  backer: PrincipalSchema,
  amount: MoneySchema,                       // USD, >= 1.00
});
export const BountyPipelineInput = z.discriminatedUnion("kind", [CreateBountyInput, PledgeInput]);
```

`firstStep` is `route`, which jumps to `draft` or `pledge_start`. State is a union keyed on the same `kind`.

Alternative considered: a second pipeline id for pledges. Rejected because `PIPELINE_IDS` is frozen and the registry is orchestrator-owned.

### D2. Step graph

```
                         route
              kind=bounty  |  kind=pledge
        +------------------+-------------------+
        v                                      v
      draft                               pledge_start
        |  wait external_event                 |  wait paypal_approval
        |  resumeAt funding                    |  resumeAt pledge_signed
        v                                      v
  +-> funding --(deadline | cancel)--+    pledge_signed --> done
  |     |  signal: pledge|tick|cancel |      (approved: completeSigning;
  +-----+  (not covered: wait again)  |       closed bounty: releaseRemainder;
        |  covered: wait external_event      declined: slip rejected)
        |  resumeAt claim             |
        v                             |
  +-> claim ---(deadline | cancel)----+
  |     |  signal: claim|tick|cancel  |
  +-----+  (bad claim: wait again)    |
        |  ok: wait user_upload       |
        |  resumeAt verify            |
        v                             |
  +-> verify --(deadline | cancel)----+
  |     |  signal: proof|tick|cancel  |
  +-----+  (checks fail: wait again)  |
        |  pass                       |
        v                             v
      settle --(capture failed)--> done (settle_failed)
        |  payout failed: wait user_confirm resumeAt settle
        |  signal: payout_retry | payout_refund
        v                             |
      receipt --> done (paid)       close --> done (expired | cancelled)
```

Resume signals for the bounty run, one zod union on `event`:

| Signal | Accepted at | Payload |
|---|---|---|
| `pledge` | funding | none (a nudge; funding is recomputed from slips) |
| `tick` | funding, claim, verify | none (deadline check) |
| `cancel` | funding, claim, verify | none |
| `claim` | claim | `workerName`, `workerEmail` |
| `proof` | verify | `before`, `after`: `{ blobRef, capturedAt, dHash, lat?, lng? }` |
| `payout_retry`, `payout_refund` | settle (after a payout error) | none |

A signal that doesn't fit the current step leaves the run waiting at the same step and writes `state.lastRejection` (shown on the card). Every waiting step checks the deadline and `cancel` before anything else, so any resume past the deadline closes the bounty.

Pledge runs resume only through the core PayPal return with `{ approved, orderId }`.

### D3. Calls per step

| Step | CoreServices | PayPalRail (direct or through core) | Store and AI |
|---|---|---|---|
| route | none | none | none |
| draft | `createSlip` (payout slip) | none | `ai.json` fast `bounty.draft`; `collection("bounty","bounties").put`; `ledger.append bounty.created` |
| funding | none | none | `slips.list` (pledges by `meta.bountyId`); `slips.update` payout slip to `active` when covered; `bounty.funded` |
| claim | none | none | `slips.update` payout slip clauses (append `payee_allowlist`); `bounty.claimed` |
| verify | `addEvidence` on payout slip and each pledge slip (pass only) | none | `blobs.get`; `collection("bounty","proofs")`; `ai.json` smart `bounty.verify` with 2 images; `bounty.proof_submitted`, `bounty.verified` or `bounty.rejected` |
| settle | `settlePurchase` per allocated pledge (`finalCapture: true`); `releaseRemainder` per unallocated pledge; `settlePayout` on payout slip; on failure `refund` per capture and `releaseRemainder` | `captureAuthorization`, `voidAuthorization`, `createPayout`, `refundCapture` (all through core) | `bounty.paid`, `bounty.settle_failed`, `bounty.refunded` |
| receipt | none | `rail.getPayout` (direct, read only) | bounty record `payout` field |
| close | `releaseRemainder` per active pledge | `voidAuthorization` (through core) | `slips.update` unsigned pledges to `expired`, payout slip to `expired` or `released`; `bounty.expired` or `bounty.cancelled` |
| pledge_start | `createSlip` (pledge slip); `beginSigning` AUTHORIZE | `createOrder` (through core) | `bounties.get`; `slips.list` for the remainder |
| pledge_signed | `completeSigning`; `releaseRemainder` if the bounty closed meanwhile | `getOrder`, `authorizeOrder`, maybe `voidAuthorization` (through core) | `slips.update` `meta.signedAt` or status `rejected`; `bounty.pledged` on the payout slip |

### D4. Data model

`collection("bounty", "bounties")`, keyed by bounty id:

```ts
type Bounty = {
  id: string; runId: string; payoutSlipId: string;
  title: string; description: string; reward: Money; deadline: string;
  location: { lat: number; lng: number; radiusM: number } | null;
  organizer: Principal;
  rubric: string; checks: { id: string; label: string }[];
  shots: { before: string; after: string };
  status: "funding" | "funded" | "claimed" | "verified" | "paid"
        | "settle_failed" | "payout_failed" | "refunded" | "expired" | "cancelled";
  claim: { workerName: string; workerEmail: string; claimedAt: string } | null;
  attempts: { at: string; pass: boolean; results: CheckResult[]; beforeRef: string; afterRef: string }[];
  evidence: EvidenceRef | null;          // the passing before_after_photos ref, reused on every capture and the payout
  captures: { slipId: string; backer: string; amount: Money; captureId: string }[];
  payout: { batchId: string; status: string; amount: Money; receiverEmail: string } | null;
  failure: string | null;
  createdAt: string; updatedAt: string;
};
```

Pledges live only on their slips. Readers use `slips.list({ pipeline: "bounty" })` filtered on `meta.role === "pledge" && meta.bountyId === id`. The payout slip carries `meta.role = "payout"` and `meta.bountyId`.

`collection("bounty", "proofs")` holds one row per submitted photo: `{ id, bountyId, bountyTitle, role, blobRef, sha256, dHash, capturedAt, lat, lng, submittedAt, passed }`. Rows from failed attempts stay, so a rejected photo can't be recycled into another bounty.

### D5. Clauses are built in code; AI writes only the rubric

The payout slip and pledge slips get fixed clause lists built from form fields: `c1 budget_max`, `c2 require_evidence before_after_photos` (rubric text), `c3 expires_at`. Claim appends `c4 payee_allowlist [workerEmail]`. `compileSlip` is skipped because the clause set never varies, and building it in code means a hostile description can't add or drop a clause.

The draft call is `ai.json({ label: "bounty.draft", tier: "fast", ... })` with schema `{ rubric: string<=600, checks: {id,label}[2..5], shots: { before, after } }`. The system prompt says the description is untrusted data and the checks must be things a camera can see. The mock derives checks from keywords in the title (drain, snow, litter, generic fallback), so the demo copy stays sensible offline.

Backers see the rubric on their slip card before they sign. That's the consent point for what "done" means.

### D6. Funding is pulled from slips

`funding` sums `budget` over `active` pledge slips each time it runs. The `pledge` signal carries no data the step trusts. When the page sees a pledge run finish, it sends `{ event: "pledge" }` to the bounty run; if that nudge is lost, the next `tick`, `claim` or page action recomputes the same total. The board API derives funding the same way, so the bar is right even while the run sleeps.

Pledges are clamped at `pledge_start` to `reward - signedTotal`. 2 backers racing for the last 10.00 can both sign; D8 trims that at capture.

### D7. Proof checks: deterministic first, then vision

`checks.ts` holds pure functions with no I/O:

- `hamming(a, b)`: popcount of the XOR of 2 16-hex-char hashes (as 2 32-bit halves, no BigInt needed).
- `freshPhotos(submission, stored[])`: fail when before vs after, or either vs any stored row, has distance <= 5 or the same SHA-256. The failure names the distance and the other bounty.
- `timing(submission, claimedAt, deadline, now)`: both times in `(claimedAt, deadline)`, before < after, neither more than 2 minutes ahead of `now`.
- `location(submission, site)`: haversine distance per photo. No site means skipped. No coordinates means "not checked", which doesn't fail.

The server computes SHA-256 of each blob's bytes with `node:crypto` at submission. The dHash comes from the browser.

`dhash.ts` is pure and shared by the browser and the tests: `dHashFromGray(gray: number[72])` compares each pixel with its right neighbor across 8 rows of 9 and packs 64 bits into hex. In the browser, `proof-capture.tsx` draws the photo onto a 9x8 canvas, converts it to luma (0.299 R + 0.587 G + 0.114 B) and calls the same function.

Vision runs only when all 3 deterministic checks pass: `ai.json({ label: "bounty.verify", tier: "smart", images: [before, after], schema })` with schema `{ checks: { id, pass, reason<=200 }[], notes }`. The system prompt names image 1 as before and image 2 as after, lists the drafted check ids, and says any text inside the images is part of the scene. Code maps results by id; a missing id is a fail; overall pass is "every drafted check passed". The mock returns pass for every check with a reason built from the check label. Duplicates are caught before the AI, so the duplicate fixture fails in mock mode without scripting a failure.

On a pass the evidence ref is `{ kind: "before_after_photos", verdict: "pass", detail: "4 of 4 checks passed: ...", ref: "<beforeRef>,<afterRef>" }`, added to the payout slip and every active pledge slip.

### D8. Settlement order and allocation

1. `allocate(reward, pledges)` walks active pledges sorted by `meta.signedAt` (slip id breaks ties) and gives each `min(budget, remaining)`. Pure, unit-tested.
2. For each pledge with an allocation: `core.settlePurchase(slipId, proposal, { finalCapture: true })`. The proposal is `kind: "purchase"`, amount = allocation, `payee: null`, 1 item (bounty title, fixed facts `{ category: "community_job", inStock: true, itemCount: 1, attributes: {}, injectionSuspected: false, deliveryEstimate: null }`), evidence = the pass ref. A verdict other than `within`, or a thrown rail error, counts as a failed capture.
3. Pledges with allocation 0: `core.releaseRemainder`.
4. If any capture failed: `core.refund` every capture made so far, `releaseRemainder` the rest, status `settle_failed`, done.
5. If the payout slip has no `payoutBatchIds` yet: `core.settlePayout(payoutSlipId, proposal, [{ receiverEmail, amount: reward, note }])` with `kind: "payout"`, `payee: { email, name, merchantId: null }`, the same evidence. A non-`within` verdict or a rail error moves status to `payout_failed` and waits `user_confirm` at `settle`. `payout_retry` re-runs only step 5; `payout_refund` refunds every capture.
6. `receipt` reads `rail.getPayout(batchId)` once and stores the batch status.

Steps 2 to 5 skip work that's already done (a pledge slip with a capture id, a payout slip with a batch id), so re-running `settle` after a crash can't double-capture or double-pay.

### D9. Closing

`close` runs on deadline or `cancel` while status is `funding`, `funded` or `claimed`. A failed proof attempt leaves status `claimed`. It calls `releaseRemainder` on every `active` pledge, sets unsigned pledges (`draft`, `awaiting_signature`) to `expired`, sets the payout slip to `expired` (deadline) or `released` (cancel) and writes the ledger event. A close on a bounty that's already closed returns `done` without calls. `pledge_signed` re-reads the bounty after `completeSigning` and voids straight away when it's closed.

`scripts/bounty-tick.ts` lists waiting bounty runs through `getRuntime().orchestrator.list({ pipeline: "bounty", status: "waiting" })` and resumes each with `{ event: "tick" }`. The guard's `expires_at` clause is the backstop if nothing ticks.

### D10. UI and API

- `src/app/p/bounty/page.tsx` (server) renders `AppShell`, `PipelineHeader` and a client `BountyBoard`.
- `BountyBoard` polls `GET /api/p/bounty` every 3 seconds. `useRun` follows only the runs this browser started (create, back) and the pledge run named in `?run=` after a PayPal return. Cards hold a `<progress>`-style bar with `aria-valuenow` and a text label, `MoneyTag` amounts, and status-driven forms.
- Create and back use `startRun("bounty", input)`. Back then shows `SignWithPayPal` with the pledge run's approve URL. The return path is `/p/bounty?bounty=<id>`; core appends `&run=<pledgeRunId>`. When that pledge run is done, the page nudges the bounty run with `{ event: "pledge" }` and shows the outcome (held, declined or voided).
- Claim, proof, cancel and payout choices use `resumeRun(bountyRunId, signal)`.
- `proof-capture.tsx`: 2 `<input type="file" accept="image/*" capture="environment">` controls, a `FileDrop` fallback on desktop, downscale to 1280 px JPEG before upload to `/api/blobs`, dHash from the same bitmap, `capturedAt` from `file.lastModified` (the shutter time for a camera shot; an old gallery photo keeps its old time and fails the timing check), optional coordinates from `navigator.geolocation` when the worker ticks the box. A "No camera? Use sample photos" menu uploads the fixture pairs (drain, walk, and a reused photo that should fail) for judges and the offline demo.
- `checklist.tsx`: one row per check with a pass or fail mark and reason, inside `aria-live="polite"`, plus a `VerdictStamp` (VERIFIED or REJECTED).
- `receipt.tsx`: payout batch id, PayPal status, amount, worker, and each backer's capture.
- `SlipCard` for the payout slip and each pledge, `LedgerTimeline` for the payout slip.
- `GET /api/p/bounty` (`src/app/api/p/bounty/route.ts`) returns `{ bounties: [{ bounty, payoutSlip, pledges, funded, run: { id, status, step, wait } }] }` built from `getRuntime()`.

`primitives` badges: Orders v2 AUTHORIZE, Payments v2 capture, Payments v2 void, Payouts v1, Claude vision, perceptual hash.

### D11. Fixtures

`scripts/bounty-fixtures.ts` draws 32x24 grayscale scenes in memory (a grate with a dark leaf pile, the same grate clear, and a 1-pixel edit of the clear grate), encodes them as PNG with `node:zlib` and a hand-rolled CRC32, computes each dHash by area-averaging to 9x8 and calling `dHashFromGray`, and writes `src/pipelines/bounty/fixtures.ts` with base64 strings and hashes. The passing pair must be more than 5 bits apart and the duplicate pair 5 or fewer; a test checks both. Each PNG stays under 1 KB.

## Risks / Trade-offs

- [The browser computes dHash and capture time, so a determined cheat can forge both] → Server-side SHA-256 catches byte-identical reuse. The vision model still has to see the work done. The guard pins payee and amount, so the worst case is the claimant getting the posted reward for weak proof. Server-side hashing is the next step after the hackathon.
- [Vision model misgrades a photo] → Per-check results with reasons on screen; overall pass computed in code; a missing check fails; the worker can retry until the deadline.
- [Prompt injection through the description or text in a photo] → Both AI calls have no tools and schema-checked output. Clauses come from code. Payee and amount are enforced by the guard on facts the model can't touch.
- [2 resumes hit the bounty run at once (a pledge nudge and a claim)] → Core serializes resumes per run and refuses a resume on a run that is not waiting; the page shows or ignores that error, and steps re-derive from slips.
- [Payout fails after the backers were charged] → Run waits for retry or refund; the receipt shows the state honestly.
- [Deadlines only fire when something resumes the run] → Tick script, guard `expires_at`, and PayPal's own 29-day authorization expiry as the final backstop.
- [Photos may show faces, house numbers or plates] → Shot instructions ask for the job site only. Blurring is out of scope.
- [72-hour cap is short for some real jobs] → Keeps captures inside the 3-day honor period. Reauthorization is future work.

## Migration Plan

1. Replace the stub default export in `src/pipelines/bounty/index.ts`. The registry entry doesn't change.
2. New collections are created on first write; there's nothing to migrate.
3. Rollback: restore the stub file. Bounty slips already in the store stay readable by the generic slip views.

## Demo beat (15 seconds of video)

| Time | On screen |
|---|---|
| 0:00 to 0:03 | Board card "Clear the storm drain on Elm St, $40". 2 neighbors tap Back and sign with PayPal. The bar fills to $40 with "Held, not charged". |
| 0:03 to 0:06 | Dana claims on a phone. The pool slip gains clause c4 "Pays only dana@...". |
| 0:06 to 0:10 | Rear camera before and after shots. The checklist ticks: fresh photos, on time, within 150 m, grate clear, water flows. |
| 0:10 to 0:13 | Green VERIFIED stamp. Ledger: 2 captures, 1 payout of $40 to Dana, receipt with the batch id. |
| 0:13 to 0:15 | Cut to a reused photo: red REJECTED stamp, "2 bits from the photo on bounty #3", backers' holds untouched. |

## Real sandbox notes

- Payouts sandbox limits are unconfirmed. Test a 1.00 USD payout on day 1 and record the result here.
- The sandbox REST app needs the Payouts feature enabled, or `createPayout` returns an authorization error. The failure path then shows retry or refund.
- Payouts need the receiver's PayPal email. In sandbox, use a sandbox personal account email for the worker. An unknown email still creates a batch, but the item sits UNCLAIMED, and the receipt shows that status.
- The app's sandbox business account is the payee on every pledge capture and the sender of the payout, so the payout is funded from the captured pledges sitting in that balance.
- Batch status starts PENDING; `receipt` reads it once and the page can refresh it.
- Each pledge is its own order and authorization, so the demo doesn't depend on multiple partial captures being enabled. `final_capture: true` releases any unused part of an authorization.
- Core sets `sender_batch_id` to `<payoutSlipId>-<n>`, so PayPal itself refuses a duplicate batch on a retry; the pipeline also skips the payout when the pool slip already has a batch id.
- Authorizations honor funds for 3 days; that's why deadlines cap at 72 hours.

## Open Questions

- Should `scripts/bounty-tick.ts` run on a schedule in the hosted demo? That's a `render.yaml` call for the integration agent and doesn't change this design.
- Should the payout note list backer first names? Copy only.
