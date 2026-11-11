# Proposal: PaySmart, the plain-words front door

## Why

The six pipelines are separate demos. A person with money to move does not know which one to open. They know what they need: a gift and a card under $60, a payment to a stranger they are unsure about, a dispute. PaySmart is one input box. It reads the ask, sends non-shopping asks to the pipeline built for them, and runs shopping asks through an agent that searches, scrapes and builds carts while every listing passes screens made from the other pipelines' code. The person picks one cart. Only then does PayPal hold money, and it holds exactly that cart's total.

## What changes

- A new pipeline id `paysmart` (`src/pipelines/paysmart/`) with steps `intake`, `understand`, `clarify`, `handoff`, `compile`, `screen_request`, `discover`, `assemble`, `board`, `choose`, `sign`, `complete_signing`, `pay`, `aftercare`, `confirm_refund`, `refund`.
- The ask arrives as text, typed or dictated in the browser (`askVia: "voice"`, display and ledger only; no audio leaves the browser).
- A router (`understand`): one no-tool `ai.json` call on the fast tier, with a deterministic mock. Six use cases: `buy`, `pay_person`, `group_buy`, `cash_check`, `paid_research`, `dispute`. Non-buy asks end with outcome `handed_off` and a card pointing at the right page. A deterministic override sends any ask with a Friends and Family, off-platform or advance-fee phrase to Second Look, whatever the model says.
- A request screen after compile and before any search: the ask must become a valid slip, with a limit of at most $1,000.00, an expiry inside 29 days and no gift-card category the person did not ask for. Failures become a clarify question, up to 2 rounds.
- Discovery (`discover`) is PaySmart's own deterministic step, one need per step, so the person watches each search land. For each need it searches (Channel3 when keyed, else the sample catalog, with a fallback to the sample catalog on a Channel3 error), screens every listing with an integrity screen (Permission Slip quarantine and injection detection) and a seller screen (Second Look scam detectors), opens the first 5 clean listings through the quarantined extractor and stamps them against the slip with the pure guard. Each search is saved as a `SearchRun` (`found`, `ruledOut`, `shown`, `inspected`) and a `paysmart.search` ledger event. Ruled-out listings stay on the board with their reasons.
- The cart agent (`assemble`, `ai.runAgent`, smart tier, 16 steps) has two tools, `inspect_listing` and `propose_cart`. It has no search tool and never sees text from a listing that failed a screen. Its task text lists the needs and, per need, the screened products with facts and slip stamps.
- A board: every inspected product gets a slip screen from the pure guard, and a funnel (found, clean, trusted, within slip, in carts) shows how many survived each screen.
- A choice screen with up to 3 guard-stamped carts. The person picks one, may edit clauses (everything is re-stamped, no new search), or declines. A decline makes zero PayPal calls.
- Payment after the choice: the hold is sized to the chosen cart's total, the person approves it on PayPal, the guard re-checks inside `settlePurchase`, and the capture is final. Delivery photo check and refund reuse Shop's helpers.
- PaySmart fixtures: a clean pop-up dinosaur card ($4.99), a battery sound card ($6.50) and a marketplace T-Rex ($38.00) whose seller asks for Friends and Family and Zelle.
- `compile` writes the router's decision to the ledger as `paysmart.routed` with `askVia`, because `understand` runs before the slip exists.
- `scripts/paysmart-smoke.ts` runs the demo ask and the red-team variant in mock mode.

## Capabilities

### New capabilities

- `paysmart`: route, screen, shop, choose and pay from one plain-words ask.

### Modified capabilities

None. PaySmart imports from Shop and Second Look and edits neither.

## PayPal APIs exercised

- Orders v2 with AUTHORIZE intent: one order, sized to the chosen cart.
- Payments v2 capture with `final_capture: true`, void (releases any remainder), refund (delivery breach).
- No Payouts, no vaulting. A decline, a request-screen failure, a hand-off and a no-options run never reach PayPal.

## AI capabilities exercised

- Structured output: the router (`ai.json`, fast tier, schema `RouteDecisionSchema`) and the delivery check (vision, `DeliveryCheckSchema`).
- Tool use: the cart agent (`ai.runAgent`, smart tier) with a 16-step cap.
- Browser dictation (Web Speech) for the ask, sent as text.
- Quarantined extractor: every inspected listing becomes facts only. The guard never reads listing text.
- Mandate compiler (`core.compileSlip`) with PaySmart guidance.
- Every call has a deterministic mock, so mock mode runs the whole flow offline.

## Impact

- New: `src/pipelines/paysmart/**` (except the frozen `types.ts`), `scripts/paysmart-smoke.ts`.
- No contract change, no new dependency, no new environment variable. Live mode reads `CHANNEL3_API_KEY` through Shop's catalog facade when it exists.
- Another worker builds `src/app/p/paysmart` against the wait data keys documented in `design.md` and `tasks.md`.

## Non-goals

- Carts across several retailers' own checkouts. The capture is one PayPal order on the slip.
- Saved payment methods or vaulting.
- Running the other pipelines' full flows inside PaySmart. Non-buy asks hand off to their pages.
- Re-scraping prices between the choice and the capture.
- Cash Weather affordability as an in-flow screen. Cash Weather data is a freelancer's business ledger, so "can I afford it" asks route to it.
- Hire Wire helpers inside PaySmart.
