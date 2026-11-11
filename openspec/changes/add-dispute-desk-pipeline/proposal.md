# Proposal: add the Dispute Desk pipeline

## Why

A small merchant who gets a PayPal dispute has about 10 days to answer, and the proof they need (what the buyer asked for, what shipped, when it arrived) is scattered across email, carrier sites and memory. Permission Slip already records that proof at the moment of purchase: a signed mandate, every guard verdict, tracking and photos, all in a hash-chained ledger per slip.

Dispute Desk is the merchant side of the same trust layer. It finds the slip behind a dispute, checks that the ledger chain still verifies, and drafts the answer from evidence that already exists. It also tells the merchant when to give up: if the slip shows a clause was broken, it recommends accepting the claim.

Prior art: Chargeflow ($35M Series A) and Justt ($30M, Dec 2024) automate chargeback responses for merchants by collecting evidence after the dispute lands. Our difference is the evidence source. The mandate, the guard verdicts and the delivery check were captured and hash-chained when the money moved, so the response cites records the merchant couldn't have edited afterwards.

## What Changes

- New pipeline `dispute-desk` (replaces the orchestrator stub in `src/pipelines/dispute-desk/index.ts`). One run per dispute, steps `load -> link -> pack -> triage -> draft -> (wait user_confirm) -> act`.
- Linking: the dispute's transaction id (the seller-side capture id) resolves to a slip through `store.slips.findByRailId`, with a fallback lookup in the second-look `handoffs` collection (records keyed by capture id, each naming a slip id).
- Evidence: `core.evidencePack(slipId)` supplies the slip, events, verdicts, evidence and chain status. A pack whose chain fails verification is never cited; the run says so and recommends `need_more`.
- Quarantine: buyer dispute messages are untrusted. They pass through `detectInjection` and one no-tool `ai.json` call that returns enum and boolean claim facts only. Raw buyer text never reaches the triage or draft prompts.
- Triage: an `ai.json` call (tier smart) over the pack summary, event digests and dispute facts returns `contest | accept | need_more`, a confidence, a rationale, and cited ledger seqs and clause ids. A deterministic honesty floor runs after it: no valid citation means no contest, a failed delivery check means accept, and a refund already on file for the same complaint is reported as "already refunded".
- Draft: `ai.text` writes the response notes in plain words (2000 characters max). The pipeline also builds an evidence document set: a JSON export of the pack and a plain-text summary, both base64, each with a sha256.
- Merchant review: a `user_confirm` wait lets the merchant edit the notes and pick contest, accept or hold.
- Act: `rail.provideEvidence` (notes plus documents) or `rail.acceptClaim`, then a `rail.dispute_evidence` or `rail.dispute_accepted` event on the linked slip's ledger.
- Demo seeding: `seedDemoDisputes(runtime, links)` for the integration stage to call after demo runs create real captures, three scenarios (not received with tracking, not as described with a breach and refund, unlinked), plus unlinked fixtures so the page works with zero prior runs.
- UI at `/p/dispute-desk`: a deadline board (CSS grid lanes by dispute status, urgency colors from the seller response due date), a dispute detail with the linked SlipCard, EvidencePackView with a "Chain verified" state, a recommendation card with cited seqs, an editable response, and act buttons.
- API routes under `/api/p/dispute-desk/`: board data (`GET disputes`) and mock-only seeding (`POST seed`). Runs use the generic `POST /api/runs` and `POST /api/runs/[id]/resume`.

PayPal APIs exercised: Disputes v1 (list disputes, show dispute details, provide evidence, accept claim), plus the sandbox-only adjudicate endpoint for manual testing. The Payments v2 capture id is the join key back to the slip.

AI capabilities exercised: a quarantined no-tool `ai.json` extraction over untrusted buyer text (tier fast), a structured `ai.json` recommendation with citations (tier smart), and `ai.text` drafting (tier smart). Every call ships a deterministic mock built from the same rules engine, so mock mode runs end to end with no keys.

## Capabilities

### New Capabilities

- `dispute-desk-pipeline`: the per-dispute run (load, link, pack, triage, draft, confirm, act), the honesty floor, buyer-text quarantine, evidence document generation, demo seeding, the deadline board and the `/p/dispute-desk` page.

### Modified Capabilities

None. The pipeline uses the frozen contract in `src/core/contracts.ts` as is.

## Impact

- Code (all inside this pipeline's owned paths): `src/pipelines/dispute-desk/**`, `src/app/p/dispute-desk/**`, `src/app/api/p/dispute-desk/**`, `scripts/dispute-desk-smoke.ts`.
- Depends on core modules being built in parallel: `@/core/money`, `@/core/ids`, `@/core/extractor` (`detectInjection`), `@/core/testing` (`createTestRuntime` with `mockRail.seedDisputes`), `@/server/runtime` (`getRuntime`), `@/components/run-client`, and the shared UI kit (AppShell, PipelineHeader, SlipCard, VerdictStamp, LedgerTimeline, MoneyTag, EvidencePackView, WaitPanel).
- Reads other pipelines' slips (read-only) and the second-look `handoffs` collection (read-only, keyed by capture id). Writes only ledger events on a linked slip and its own `dispute-desk` collection.
- No new npm dependencies. No contract changes.

## Non-goals

- Webhook-driven runs on `CUSTOMER.DISPUTE.CREATED`. Runs start when the merchant opens a dispute on the board.
- Escalating a dispute to a claim, making offers (`make-offer`), or sending messages to the buyer.
- Changing the linked slip's status or touching its authorization, captures or refunds. Dispute Desk only appends ledger events.
- Issuing refunds. If a refund is already on file, the run reports it; it never creates one.
- Uploading images or PDFs. The evidence documents are JSON and plain text generated from the pack.
- Chargebacks that arrive outside PayPal's Disputes API, and win-rate analytics.
- Drag and drop between board lanes. Lanes reflect PayPal's status; the merchant can't move a card by hand.
