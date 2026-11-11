# Proposal: add the bounty pipeline

## Why

Small paid jobs on a street (clear a storm drain, shovel a senior's walk) stall on trust. Backers can't check the work, and the person who did it waits days to get paid, if they get paid at all.

Permission Slip already holds money under a signed mandate and only lets it move when the facts match. The bounty board points that machinery at a crowd: each neighbor's money sits in a PayPal authorization until photos prove the job is done, and then it pays the worker in one PayPal Payouts batch. If the proof never comes, every hold is voided and nobody is charged.

## What Changes

- Replace the `bounty` pipeline stub with a working pipeline that runs 2 kinds of run, picked by an input discriminator:
  - a **bounty run** for one bounty's whole lifecycle: draft, funding, claim, proof, verify, settle, close.
  - a **pledge run** per backer: create the backer's slip, sign it with PayPal (AUTHORIZE), hold the money, report back to the board.
- Add a payout slip per bounty (principal "Bounty pool: <title>", budget = reward, clauses `budget_max`, `require_evidence` `before_after_photos` with the rubric, `expires_at` deadline). It has no PayPal order. A `payee_allowlist` clause naming the worker's PayPal email is added when someone claims the job.
- Add one slip per pledge (`meta.bountyId`), signed with an AUTHORIZE order. Pledges stop once signed pledges cover the reward.
- AI drafts the rubric, 2 to 5 named checks and the before/after shot instructions from the organizer's description (structured output, fast tier, no tools).
- Proof verification in 2 layers: deterministic checks first (near-duplicate photos by 64-bit dHash with Hamming distance 5 or less, exact duplicates by SHA-256, capture times inside the claim window, optional distance from the job site), then a smart-tier vision call that grades both photos against the rubric check by check.
- On a pass: capture every pledge with `final_capture`, then pay the reward to the worker through Payouts. On deadline or cancellation: void every pledge authorization.
- New UI at `/p/bounty`: board of bounty cards with a funded bar, create form, back button, claim form, camera proof capture, verification checklist, payout receipt, slip cards and ledger timeline.
- New read-only API `GET /api/p/bounty` for the board. Everything else goes through the generic run APIs (`POST /api/runs`, `POST /api/runs/[id]/resume`, `/api/blobs`).
- Mock fixtures: a tiny generated passing before/after PNG pair and a duplicate pair, so the full lifecycle runs offline.
- `scripts/bounty-tick.ts` nudges waiting bounty runs so past-deadline bounties close and release their holds.

### PayPal APIs exercised

- Orders v2: create order (intent AUTHORIZE), authorize order (through `core.beginSigning` and `core.completeSigning`).
- Payments v2: capture authorization with `final_capture: true`, void authorization, refund capture (only on a failed settlement).
- Payouts v1: create batch payout to the worker's email, get batch status for the receipt.

### AI capabilities exercised

- Structured output (fast tier): rubric, checks and shot instructions drafted from free text.
- Vision with structured output (smart tier): 2 images graded against the rubric, a pass or fail and a reason per check.
- Every call has a deterministic mock, so mock mode needs no keys.

## Capabilities

### New Capabilities

- `bounty-pipeline`: neighbor-funded bounties where backer money is held by PayPal authorizations, released to the worker through PayPal Payouts only after photo proof passes deterministic and vision checks, and voided on expiry or cancellation.

### Modified Capabilities

None.

## Impact

- Code (all inside the bounty agent's paths): `src/pipelines/bounty/**`, `src/app/p/bounty/**`, `src/app/api/p/bounty/**`, `scripts/bounty-*.ts`.
- Uses the frozen contract in `src/core/contracts.ts` unchanged. Depends on core helpers `@/core/money`, `@/core/ids`, `@/core/testing`, `@/server/runtime`, the client `@/components/run-client` and the shared UI components.
- Data: 2 pipeline collections, `bounties` and `proofs`, through `store.collection("bounty", ...)`. Proof photos live in the blob store.
- Ledger: namespaced `bounty.*` events on the payout slip.
- No new npm dependencies. dHash runs in the browser on a canvas; the server only compares hashes.

## Non-goals

- User accounts or sign-in. Anyone can create, back, claim or cancel in the demo.
- Reauthorizing holds for long bounties. Deadlines are capped at 72 hours so captures stay inside PayPal's 3-day honor period.
- More than 1 worker per bounty, split payouts, or partial payouts for partial work.
- Platform fees or tips.
- Server-side image decoding or EXIF parsing. The dHash is computed by the client.
- Disputes on pledges (the dispute-desk pipeline owns disputes).
- Currencies other than USD.
- Background schedulers. Deadlines are enforced when a run is resumed and by the guard's `expires_at` clause.
