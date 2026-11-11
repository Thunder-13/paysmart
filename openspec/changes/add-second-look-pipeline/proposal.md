# Proposal: add the Second Look pipeline

## Why

People get scammed at the moment they pay a stranger. The FTC counted $15.9B in reported fraud losses for 2025, and FBI IC3 puts losses for adults 60 and older at about $7.7B for the same year. A stock line in marketplace scams is "send it as friends and family to skip the fee", and PayPal lists Friends and Family payments as not eligible for Purchase Protection. Bank warnings tell people to be careful and stop there. Second Look gives the buyer a safe way to still buy the thing: it reads the chat, names the tactics in it, and turns the risky send into a protected PayPal goods payment under a Slip.

## What Changes

- New pipeline `second-look` that replaces the orchestrator stub at `src/pipelines/second-look/index.ts`.
- Scam analysis over pasted chat text, an optional chat screenshot and the listing text. It returns tactics from a fixed ten-item taxonomy (`ff_request`, `urgency`, `off_platform`, `too_good_price`, `ship_only`, `overpayment`, `gift_card_or_crypto`, `identity_mismatch`, `refuses_protection`, `advance_fee`), each with the exact quoted line, a 0 to 100 risk score and a plain-words risk card.
- Chat and listing text are handled as untrusted data. One no-tool structured AI call with a hardened system prompt runs next to deterministic phrase detectors, and the two result sets are unioned. The model can add findings. It cannot remove a detector finding or pull the score below the detector floor.
- A deterministic Slip for each payment: `payee_allowlist` [seller email], `budget_max` [amount], `require_evidence` [tracking], `expires_at`.
- The honest-offer test. The buyer sends a ready-made message offering a protected goods payment. An honest seller accepts. A refusal ends the run with a walk-away recommendation.
- Protected payment: a PayPal Orders v2 CAPTURE order with the seller as `purchase_units[].payee.email_address`, buyer approval, capture, then shipment tracking attached to the capture and recorded as slip evidence.
- Family mode: an in-app trusted-contact inbox gets the risk card when risk is 60 or more or the seller refuses.
- "Item never arrived" hand-off: a record that points the Dispute Desk pipeline at the capture and its evidence pack.
- UI page `/p/second-look` and two small pipeline API routes (alerts inbox, hand-off).
- Three original mock conversations (clear scam, legit seller, borderline) so the whole flow runs offline.

## Capabilities

### New Capabilities

- `second-look-pipeline`: scam-tactic analysis of untrusted chat and listing content, the honest-offer flow, a guarded protected PayPal payment to a stranger with shipment tracking evidence, family alerts, and the hand-off record for disputes.

### Modified Capabilities

None. The pipeline builds on the frozen contract in `src/core/contracts.ts` and the core services without changing their behavior.

## PayPal APIs and AI capabilities exercised

- PayPal Orders v2: create order with `intent: CAPTURE` and `purchase_units[].payee.email_address`, buyer approval redirect, capture order (through `core.beginSigning` and `core.completeSigning`).
- PayPal shipment tracking on the capture (`rail.addTracking`, Orders v2 track endpoint).
- Anthropic structured output (`ai.json`, smart tier) with vision when a chat screenshot is supplied. No tools are given to the model.
- Deterministic guard: `payee_allowlist`, `budget_max` and `expires_at` clauses decide whether the order may be created at all.
- Hash-chained ledger and evidence pack (consumed later by Dispute Desk).

## Non-goals

- Sending real email or SMS to the trusted contact. The family inbox is in-app only.
- Opening a PayPal dispute or claim from this pipeline. The hand-off record is the boundary, and Dispute Desk owns what happens after it.
- Holding funds in escrow or using AUTHORIZE intent. The protected path is a normal goods payment captured on approval.
- Promising Purchase Protection coverage. The app routes the buyer onto the eligible payment type; PayPal's own terms decide each claim.
- Scraping marketplaces or reading chats from other apps. The buyer pastes or drops what they already have.
- A labeled scam dataset or model fine-tuning. Three original fixtures cover the demo and tests.

## Impact

- Code (owned paths only): `src/pipelines/second-look/**`, `src/app/p/second-look/**`, `src/app/api/p/second-look/**`, `scripts/second-look-*.ts`.
- Uses without editing: `@/core/contracts`, `@/core/money`, `@/core/ids`, `@/core/extractor` (`detectInjection`), `@/core/testing`, `@/server/runtime`, `@/components/run-client`, the shared UI kit, `POST /api/runs`, `POST /api/runs/[id]/resume`, `/api/blobs`, and the core PayPal return route.
- Data: two pipeline-owned collections, `second-look/alerts` and `second-look/handoffs`. The hand-off record shape is a cross-pipeline interface read by Dispute Desk.
- Config: an optional env var for a sandbox seller email used to prefill fixtures in sandbox mode (requested from the owner of `.env.example`).
- No new dependencies.
