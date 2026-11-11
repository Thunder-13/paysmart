# Proposal: add the shop pipeline

## Why

AI agents now buy things for people, and the only rule between an agent and the money is a sentence in its prompt that any listing can rewrite. The shop pipeline is the hero flow of Permission Slip and the video: plain words in, numbered clauses out, a real PayPal hold, an agent shopping on Channel3, and a guard the agent can't talk to stamping every cart before a cent moves.

## What changes

- New `shop` pipeline (replaces the orchestrator stub in `src/pipelines/shop/index.ts`). Steps: intake, compile, confirm the slip, sign with a PayPal AUTHORIZE hold, shop, confirm the cart, settle (one final capture plus release), delivery photo check, refund on breach.
- Shopping agent with 4 tools: `search_products`, `inspect_listing`, `propose_cart`, `hire_helper`. The agent proposes carts by listing id and quantity. Prices and facts come from the pipeline's own listing cache, so a hijacked agent can't forge them.
- Channel3 search client (`POST https://api.trychannel3.com/v1/search`, `x-api-key`) with an offline fixture catalog of 8 fictional dinosaur gifts when `CHANNEL3_API_KEY` is empty.
- Red-team mode: a planted "Dino Mega Bundle" listing hides an instruction telling AI agents to buy 4 units plus a $200 gift card. In mock mode the agent takes the bait, gets an OUTSIDE stamp citing c1, c2 and integrity, then re-plans to a clean $42.18 item that stamps WITHIN.
- Hire-a-helper child slips (Hire Wire, idea 6): the agent can hire a "card writer" helper for $3.00 on a child slip with budget, rate card, work-product evidence and payee allowlist clauses. A rubric judge grades the helper's output, the helper is paid through PayPal Payouts at checkout, and the fee is recovered in the parent's single final capture.
- Voice add-on (Talk to Pay, idea 4): dictation into the intent box, the slip, clauses and verdict stamps read aloud, and a spoken "approve cart" for the cart confirmation. Feature-detected; every action keeps a keyboard path.
- Shop console page at `/p/shop`: slip card with nested child slips on the left, live agent activity in the center, ledger timeline on the right, red-team and helper toggles, voice controls.
- Scripts: `scripts/shop-smoke.ts` runs the full mock flow in a terminal and prints the ledger; `scripts/shop-make-sample-photo.ts` generates the sample delivery photo.

## Capabilities

### New capabilities

- `shop-pipeline`: Permission Slip shopping end to end, including the Channel3 catalog, the guarded shopping agent, red-team mode, hire-a-helper child slips, settlement, the delivery check with refund, the shop console UI and the voice add-on.

### Modified capabilities

None. The pipeline builds on the core platform through the frozen contract in `src/core/contracts.ts`.

## PayPal APIs exercised (through CoreServices and the PayPalRail)

- Orders v2: create order with intent AUTHORIZE, buyer approval, authorize order.
- Payments v2: capture authorization with `final_capture: true` (one capture per slip), void authorization for the unspent remainder and on cancel, refund capture (partial, goods only).
- Payouts v1: one payout to the helper's sandbox email per accepted helper task.
- Webhooks (core-owned) keep the ledger in sync; the pipeline reads the ledger.

## AI capabilities exercised

- Structured output: the mandate compiler (`core.compileSlip`), the helper rubric judge (`ai.json`, fast tier).
- Tool use: the shopping agent (`ai.runAgent`, smart tier, 4 tools, at most 3 cart proposals).
- Quarantined extraction: listing text goes through the core extractor plus `detectInjection`; the guard reads facts only.
- Text generation: the card-writer helper (`ai.text`, fast tier).
- Vision: the delivery photo check (`ai.json` with an image, smart tier) against the slip clauses and listing facts.
- Browser speech: Web Speech API recognition and `speechSynthesis` (client only, no server AI).

Every AI call carries a deterministic mock, so the whole flow runs offline.

## Impact

- New code under `src/pipelines/shop/**`, `src/app/p/shop/**`, `src/app/api/p/shop/**`, `scripts/shop-smoke.ts`, `scripts/shop-make-sample-photo.ts`.
- Reads env `CHANNEL3_API_KEY` (already in `.env.example`) and a new optional `SHOP_HELPER_EMAIL` (the helper's sandbox receiver; needs an `.env.example` line from the orchestrator).
- Depends on core services that are being built now: `compileSlip`, `createSlip`, `beginSigning`, `completeSigning`, `evaluate`, `createChildSlip`, `settlePayout`, `settlePurchase`, `releaseRemainder`, `refund`, `addEvidence`, `evidencePack`, plus the generic run APIs and UI kit.
- No new npm dependencies.

## Non-goals

- Checkout at real retailers. In sandbox the app is the merchant of record and Channel3 is the catalog only.
- Multi-merchant carts, multiple partial captures, reauthorization flows.
- Vaulted or long-lived mandates (vaulting is refused for platform apps in sandbox).
- Voice-driven PayPal signing. The PayPal approval stays a click on PayPal's page.
- More than one helper per slip, or helpers hiring helpers.
- The 40-listing red-team suite and its README numbers (owned by the integration agent under `scripts/redteam*.ts`).
