# Design: PaySmart, the plain-words front door

## Context

Six pipelines already exist, each a standalone demo. PaySmart is the seventh pipeline id
(`paysmart`) and the one a shopper actually talks to. You type what you need. An agent
searches and scrapes listings, every listing goes through screens built from the other
pipelines, the agent puts screened products into up to three carts, and the guard stamps
each cart. You pick one. Only then does PayPal hold money, exactly the cart total, and the
guard re-checks the cart before the capture. Asks that are not shopping go to the pipeline
built for them.

Frozen types: `src/pipelines/paysmart/types.ts` (orchestrator-owned). Workers do not edit it.

## Goals / Non-goals

Goals: one input box for every use case; agent-driven search, cart building and filtering
with a reason for every product it drops; the person makes the final choice; payment only
after that choice; every screen reuses an existing pipeline's code; mock mode runs the
whole flow offline; live mode uses Channel3, Anthropic and the PayPal sandbox when keys exist.

Non-goals: carts across several retailers' own checkouts (the capture is one PayPal order on
the slip); saved payment methods or vaulting (refused in sandbox); running the other
pipelines' full flows inside PaySmart (non-buy asks hand off to their pages); live price
re-scrape between choice and capture; Cash Weather affordability as an in-flow screen
(Cash Weather data is a freelancer's business ledger, so "can I afford it" asks route to it).

## Use-case map

How each existing pipeline is used, inside the flow or at the front door.

| Pipeline | Where PaySmart uses it | Code reused | What the person sees |
|---|---|---|---|
| Shop (Permission Slip) | Request screen, integrity screen, slip screen, cart stamps, settle, delivery check, refund | `core.compileSlip`, `shop/compile` (`slipProblem`, `validateClauseEdits`, `uncheckableAttributes`), `shop/catalog.searchCatalog`, `shop/tools` (`mockFactsFor`, `suspiciousLines`, `visibleText`, `sortOptions`), `core.evaluate`, pure `ctx.guard`, `core.settlePurchase`, `shop/delivery` helpers, `core.refund` | The slip card, a stamp on every product and cart, the receipt |
| Second Look | Request screen (payment-method red flags in the ask), seller screen on every listing | `second-look/detectors.detect` and `DETECTOR_RULES`, `second-look/taxonomy.TACTIC_LABELS` | "Seller asks for Friends and Family" with the quoted line; scam-shaped asks handed to Second Look |
| Hire Wire (Shop helper) | Not in this change | none | none |
| Bounty Board | Front door: group-pay asks | route only | Handoff card to `/p/bounty` |
| Cash Weather | Front door: forecast and invoice asks | route only | Handoff card to `/p/cash-weather` |
| Toll Road | Front door: paid-research asks | route only | Handoff card to `/p/toll-road` |
| Dispute Desk | After payment: a dispute on a PaySmart capture finds this slip through `slips.findByRailId` and its chain. Front door: dispute asks | `dispute-desk/link` (test only) | "Dispute-ready: this payment's evidence is chained" on the receipt; handoff card for dispute asks |

## Step graph

```
intake
  -> understand                       router: one ai.json call (tier fast), deterministic mock
       non-buy use case  -> handoff   done, outcome handed_off, no slip, no PayPal call
       clarify needed    -> [user_confirm stage=clarify] clarify -> understand
  -> compile                          core.compileSlip(pipeline "paysmart") + core.createSlip
  -> screen_request                   deterministic; fail -> clarify wait or done(blocked)
  -> discover (loops: one need per step, next "discover" until every need is searched)
                                      PaySmart runs the search itself, screens every result, inspects the top
                                      INSPECT_PER_NEED eligible ones, stamps them against the slip
  -> assemble                         ai.runAgent (tier smart): inspect_listing, propose_cart (no search tool)
  -> board                            final per-product stamps, funnel; no options -> done(no_options)
  -> [user_confirm stage=choose] choose
       clauses edited    -> re-stamp products and options, wait again
       declined          -> done(cancelled), zero PayPal calls
  -> sign                             size hold to chosen cart, core.beginSigning(AUTHORIZE)
  -> [paypal_approval] complete_signing  core.completeSigning
  -> pay                              core.settlePurchase(finalCapture true); outside or error -> void, done
  -> [user_upload stage=delivery] aftercare   skip -> done(paid)
       breach, high confidence -> refund -> done(refunded)
       breach, lower confidence -> [user_confirm stage=refund] confirm_refund -> refund | done(paid)
```

Step names above are fixed; the UI keys off `wait.data.stage` and `run.state`.

### Steps and the services they call

| Step | Calls | Writes |
|---|---|---|
| intake | `catalogSource(readChannel3Key())` | state.catalogSource |
| understand | `ctx.ai.json` (schema `RouteDecisionSchema`, mock `mockRoute`), `second-look/detectors.detect` on the ask | state.route; ledger after slip exists only |
| clarify | none | state.clarifications |
| handoff | none | state.handoff, outcome handed_off |
| compile | `ctx.core.compileSlip`, `ctx.core.createSlip`, ledger `slip.compiled` | slipId, state.compiled |
| screen_request | `slipProblem`, budget cap, `detect` | state.requestScreen, ledger `paysmart.request_screened` |
| discover | `searchCatalog`, PaySmart fixtures, `detect`, `detectInjection` (`@/core/extractor`), `ctx.extractor.extract`, pure `ctx.guard`, `affiliateLink` | state.searches (one `SearchRun` appended), products, discoverCursor; ledger `paysmart.search`, `paysmart.listing_screened`, `paysmart.listing_inspected` |
| assemble | `ctx.ai.runAgent`, `ctx.extractor.extract` (only for eligible listings discovery did not inspect), `ctx.core.evaluate` per proposed cart | state.options, ruledOut, products; ledger `guard.verdict`, `agent.step` |
| board | pure `ctx.guard(slip, singleItemProposal, spent, now)` per inspected product | state.products[].screens, state.funnel; ledger `paysmart.board` |
| choose | `validateClauseEdits`, `ctx.store.slips.update`, `ctx.core.evaluate` on the chosen option, attestations as in Shop | ledger `paysmart.clauses_edited`, `paysmart.option_chosen` |
| sign | `ctx.store.slips.update(budget = chosen total)`, `ctx.core.beginSigning(slipId, {intent: "AUTHORIZE", returnPath: "/p/paysmart"})` | state.hold; ledger `paysmart.hold_sized` |
| complete_signing | `ctx.core.completeSigning` | none |
| pay | `ctx.core.settlePurchase(slipId, cart, {finalCapture: true})`, `ctx.core.releaseRemainder` | state.captureId, totals; ledger `paysmart.outcome` |
| aftercare | vision check with `shop/delivery` helpers (`DELIVERY_SYSTEM`, `deliveryPrompt`, `mockDeliveryCheck`, `cleanBreaches`, `refundDecision`), `ctx.core.addEvidence` | state.delivery; ledger `paysmart.delivery_checked` |
| refund | `ctx.core.refund` | state.refundId, outcome refunded |

Every ledger event's `data` carries a plain-words `message` (the shared event text reads it).
`understand` runs before the slip exists, so its route is written to the ledger by `compile`
as `paysmart.routed`, with `askVia`.

## Router (understand)

- Input is the ask plus `clarifications` joined with newlines. The ask is the principal's own
  words, so it is instruction, but any pasted chat inside it is still only scanned by
  detectors, never executed.
- Live: one `ai.json` call, no tools, schema `RouteDecisionSchema`, tier fast.
- Mock (`mockRoute(text)`), deterministic, keyword rules checked in this order:
  dispute (`dispute|chargeback|claim`), pay_person (`marketplace|stranger|seller wants|friends and family|f&f|zelle|wire`),
  group_buy (`pool|chip in|split .* neighbou?rs|neighbou?rs`), cash_check (`forecast|invoice|cash flow|afford`),
  paid_research (`paywall|articles|research agent`), else buy. For buy, needs come from
  splitting the ask on ` plus `, ` and a `, ` and an `, `, plus `; each part becomes one need
  with a short query (the part's noun phrase: drop budget, date and exclusion sentences).
  The demo ask yields exactly two needs: a dinosaur gift and a birthday card.
- Deterministic overrides, after the model answers: if `detect` on the ask finds
  `ff_request`, `off_platform` or `advance_fee`, the use case becomes `pay_person` and the
  handoff carries those quotes. A buy ask with zero needs gets `clarify` "What should I look for?".
- `clarify` non-null on a buy ask -> clarify wait. After `MAX_CLARIFY` rounds the run ends
  blocked with the last question in `note`.

## Request screen (screen_request)

Runs after compile, before any search, so a bad ask moves no money and costs no scraping.
All deterministic. One `ScreenResult` per rule, all with `screen: "request"`:

1. Slip is valid: `slipProblem(clauses, budget)` is null. Else clarify wait with that problem.
2. Limit has a budget_max clause and is at most `PAYSMART_MAX_LIMIT`. Else clarify wait
   ("PaySmart caps one ask at $1,000.00 in this build. What is your limit?").
3. Expiry within 29 days (PayPal authorization validity). The compiler's `expires_at` is
   clamped to 29 days with a pass result saying so; never a fail.
4. Category check: `category_in` exists and does not include `gift_card` unless the ask
   names a gift card. Fail -> clarify wait.
A clarify wait from this step resumes at `clarify`, which re-runs understand and compile
(the old slip is rejected with a `slip.status` event; a new slip is created).

## Compile guidance

PaySmart passes its own `guidance`: clause kinds `budget_max`, `quantity_max`, `category_in`,
`deliver_by`, `exclude_attribute`, `expires_at`; categories `toy`, `gift`, `book`, `game`,
`clothing`, `greeting_card`, `party_supplies`, `home`, `electronics`, `gift_card`; attributes as in
Shop. `quantity_max` is the total units across the basket: `guard.ts` `checkQuantity` sums
`quantity * (facts.itemCount ?? 1)` over all lines, so a gift + card basket needs
`quantity_max` 2 (the sum of the needs' quantities), and a 4-pack counts as 4.
`mockCompile` for PaySmart is its own function (budget from the ask, categories from the
needs' keywords, `deliver_by` from a weekday, `exclude_attribute power_source=battery` from
"no batteries" or "nothing that needs batteries").

## Discovery: PaySmart runs the searches

Discovery belongs to PaySmart, not to the agent. The router turns the typed or spoken ask
into needs (gift, card, ...), and PaySmart runs one search per need, in order, one need per
`discover` step. The step returns `next: "discover"` until `discoverCursor` reaches the
number of needs, so the run state is saved after each search and the page shows every
search as it lands. The person sees, per need: what PaySmart understood, the exact query,
the source (Channel3 or the offline catalog), how many listings came back, how many the
screens dropped and why, and the products that are left.

One `discover` step, for need `i`:

1. Search: `searchCatalog` with `{query: need.query, limit: RESULTS_PER_SEARCH, maxPrice: limit}`
   (Channel3 when keyed, else Shop fixtures; `redTeam` plants Shop's hijack listings), merged
   with PaySmart fixtures whose keywords match the query. In live Channel3 mode PaySmart
   fixtures are merged only when `redTeam` is on, with `source: "planted"`. A Channel3 error
   falls back to fixtures for that search and says so in the `SearchRun` (source "fixtures")
   and the ledger message. A listing already on the board from an earlier need is not added
   twice; it keeps its first need.
2. Screen every new listing, deterministic, before anything else sees it:
   - seller screen: `detect([{source: "listing", text: title + "\n" + description}])`; any
     finding -> `fail` with `TACTIC_LABELS[id]` and the quote.
   - integrity screen: injection detection on title and description; a hit -> `fail`
     "Hidden instructions to an AI" with the clipped suspicious line.
3. Inspect the first `INSPECT_PER_NEED` listings that passed both screens: quarantined
   `ctx.extractor.extract` (mock `mockFactsFor` or PaySmart fixture facts). If the extractor
   flags injection, integrity flips to `fail`.
4. Slip-stamp each inspected product with the pure guard on a one-line proposal (its price,
   quantity from the need). Others get `slip: skipped`, status `unchecked`.
5. Append a `SearchRun` (`found`, `ruledOut`, `shown`, `inspected`, `listingIds`) and one
   `paysmart.search` ledger event whose message reads like
   "Searched Channel3 for \"dinosaur toy\" (a dinosaur gift): 12 found, 2 dropped by screens, 10 shown".

## Assemble: the agent builds carts from the screened pool

The agent never searches and never sees a listing that failed a screen. Its task text lists
the needs and, per need, the eligible products (id, title, price, domain, a `visibleText`
snippet of at most 160 chars, the facts, and the slip stamp), plus the clauses and the limit.
Tools:

- `inspect_listing({listingId})`: only for eligible listings discovery did not inspect.
  Quarantined extract as above; an injection flag rules the listing out. Unknown or
  ruled-out id -> tool error text, no throw.
- `propose_cart({items: [{listingId, quantity}], rationale})`: every line must be an
  inspected, eligible listing; builds a `NewProposal` (kind `purchase`) and calls
  `ctx.core.evaluate`. WITHIN or ASK -> an option (max `MAX_OPTIONS`, duplicates by
  listing+quantity set refused); OUTSIDE -> `ruledOut` with clause ids. Returns the stamp and
  the cited clauses in plain words so the agent can try another cart.

Caps: 16 agent steps, `MAX_OPTIONS` carts. Options are sorted with Shop's `sortOptions`
(WITHIN first, then ASK, proposal order inside each).

Mock agent script (deterministic, through the real tools): propose (1) the default gift +
clean card, (2) a cheaper gift + clean card, (3) a cart with the battery card, which the
guard stamps OUTSIDE on the exclusion clause. With `redTeam`, also try the planted hijack
cart, which the tool refuses (ruled out by the integrity screen). The script also tries to
name the scam seller; the tool refuses it, and a test checks that.

## Voice

The ask can be typed or dictated. Dictation runs in the browser (Web Speech API, the same
approach as Shop's voice add-on in `src/pipelines/shop/voice.ts` and
`src/app/p/shop/voice-controls.tsx`) and is sent as text with `askVia: "voice"`. No audio
leaves the browser. Where the browser has no speech recognition, the mic button is hidden.
On the choose step, "option two" style commands pick an option with `via: "voice"`, reusing
Shop's voice command parser if it fits the option list.

## PaySmart fixtures

`src/pipelines/paysmart/fixtures.ts`, merged with Shop's, same `FixtureListing` shape where it
fits. At least:
- a clean pop-up dinosaur birthday card, about $4.99, greeting_card, no power, arrives early;
- a roaring sound card, about $6.50, greeting_card, `power_source: battery`;
- a marketplace animatronic T-Rex, about $38.00, seller text with "today only" and
  "pay me by friends and family or Zelle so we skip fees" (seller screen fails on
  `ff_request` and `off_platform`).
Always present in fixture mode, so the default demo shows the seller screen working.

## Board

After the agent stops: every product with facts (from discovery or the agent's
`inspect_listing`) gets a fresh slip stamp from the pure guard on a one-line proposal at its
own price (quantity from its need). Products without facts keep `slip: skipped`, status
`unchecked`. The board groups products by need, one lane per `SearchRun`. Funnel: found (all listings), clean (integrity not
fail), trusted (clean and seller not fail), withinSlip (trusted and slip pass), inCarts
(distinct listing ids across options). No options -> release nothing (no hold exists), reject
the slip, done `no_options` with a note naming the top two reasons products were dropped.

## Choose

Wait `user_confirm`, `data.stage = "choose"`, data: options, ruledOut, funnel, clauses, limit,
problem. Signal `ChooseSignalSchema`:
- invalid -> same wait with "Pick an option or decline."
- `approved: false` -> slip rejected, done `cancelled`, no PayPal call was ever made.
- `clauses` present and changed (`validateClauseEdits`) -> update the slip, ledger
  `paysmart.clauses_edited`, re-stamp every product and every option with the new clauses
  (options now OUTSIDE move to ruledOut), wait again. No re-search.
- chosen option re-evaluated with `core.evaluate`; OUTSIDE -> wait again with the cited
  clauses; ASK -> attestations exactly as Shop's `confirm_cart` (missing -> wait again).

## Sign, pay

- sign: `slips.update(slipId, {budget: chosen.proposal.amount})`, ledger `paysmart.hold_sized`
  `{limit, held}`, then `beginSigning` AUTHORIZE with `returnPath "/p/paysmart"`. Wait
  `paypal_approval`, `data.stage = "sign"`, `{approveUrl, orderId, amount}`.
- complete_signing: declined -> slip rejected, done `cancelled`. Error -> `fail` with text.
- pay: `settlePurchase(finalCapture: true)`. Verdict not within -> `releaseRemainder`,
  done `blocked` citing clauses. PayPal error -> `releaseRemainder`, done `capture_failed`.
  Success -> `releaseRemainder` (safe twice), totals, then wait `user_upload` stage delivery.

## Security and failure rules

- No PayPal call before the person picks a cart and approves on PayPal.
- Listing and seller text never reaches the agent unscreened. The guard decides on facts;
  the one listing string it reads is the item title, in Shop's fail-safe multi-pack check,
  which can only move a verdict to ask (same rule as the rest of the repo, see README).
- The agent's rationale is displayed, never evaluated.
- Every resume signal is zod-validated; bad input re-waits with a message, never throws.
- Re-guard at choose and again inside `settlePurchase`, so a clause edit or an expired slip
  can still stop the capture.
- A run that waits never holds money it does not need: the hold equals the chosen cart.

## Testing

Vitest next to the code, `createTestRuntime()` from `@/core/testing`, mock rail + mock AI:
router table (one ask per use case incl. the six `PAYSMART_EXAMPLES`), detector override,
request screen fails (no budget, over cap, gift card not asked for), seller screen quote,
integrity screen on Shop's planted listing, discovery runs one search per need with
correct `SearchRun` counts and saves state between needs (a run paused after the first
`discover` step has exactly one search), the agent's tools offer no search, battery card
stamped OUTSIDE on the exclusion clause, e2e demo (choose -> approve -> captured = chosen total, released 0.00, chain
verified, outcome paid), option 2 path, clause edit re-stamp, decline makes zero rail
calls (`MockRailControls.calls()`), capture failure voids, delivery breach refunds, every
handoff, and a Dispute Desk lookup that finds the PaySmart slip by its capture id.
