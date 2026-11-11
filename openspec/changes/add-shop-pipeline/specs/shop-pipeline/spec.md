# Spec delta: shop-pipeline

## Purpose

Lets a person write in plain words what an AI agent may buy, holds exactly that much with a PayPal authorization, and lets the agent shop under a guard it can't talk to, with capture, release, a delivery check and a refund on breach. Includes the hire-a-helper child slips and the voice add-on.

## ADDED Requirements

### Requirement: Plain-words intent compiles to a numbered slip

The shop pipeline SHALL turn the user's intent into a draft slip of numbered clauses (`c1`, `c2`, ...) using only these clause kinds: `budget_max`, `quantity_max`, `category_in`, `deliver_by`, `exclude_attribute`, `expires_at`. The slip budget MUST equal the amount of its single `budget_max` clause, in USD. The user's words MUST be stored verbatim as the slip intent. The `expires_at` clause MUST be no later than 72 hours after compilation, to match PayPal's 3-day authorization honor period.

#### Scenario: Demo intent compiles to six clauses

- **WHEN** a run starts with the intent "Birthday gift for my nephew Leo, turning 6, loves dinosaurs. Under $60. Has to arrive by Saturday. Nothing that needs batteries." in mock mode
- **THEN** the draft slip has budget $60.00 and clauses c1 `budget_max` $60.00, c2 `quantity_max` 1, c3 `category_in` toy or gift, c4 `deliver_by` the next Saturday after the run's clock date, c5 `exclude_attribute` power_source in battery or rechargeable, c6 `expires_at` 72 hours after compilation
- **AND** the run waits for user confirmation with the slip summary and clauses

#### Scenario: Intent without an amount

- **WHEN** the compiled slip has no `budget_max` clause
- **THEN** the pipeline MUST NOT start signing
- **AND** the confirmation wait tells the user to add a spending limit

### Requirement: The user reviews and edits clauses before signing

The pipeline SHALL wait for the user to approve, edit or reject the draft slip before any PayPal call. Edited clauses MUST validate against the clause schema and MUST keep exactly one `budget_max` clause with a positive amount. Approved edits MUST update the slip's clauses and budget and MUST be recorded on the slip's ledger with the user as actor.

#### Scenario: User lowers the budget

- **WHEN** the user approves with c1 changed to $50.00
- **THEN** the slip budget becomes $50.00
- **AND** the ledger records the edit with actor `user`
- **AND** the PayPal hold in the next step is for $50.00

#### Scenario: Invalid edit

- **WHEN** the user approves with two `budget_max` clauses or a malformed clause
- **THEN** the slip is unchanged
- **AND** the run waits again with a message naming the problem

#### Scenario: User rejects the slip

- **WHEN** the user rejects the draft slip
- **THEN** the slip status becomes `rejected`
- **AND** the run finishes with outcome `cancelled` and no PayPal order is created

### Requirement: Signing places a PayPal authorization hold for the budget

After approval the pipeline SHALL create a PayPal order with intent AUTHORIZE for the slip budget and wait for the buyer's PayPal approval. On approval it SHALL authorize the order, so the slip becomes `active` with an authorization id and the ledger shows the amount held. The agent MUST NOT start shopping until the slip is `active`.

#### Scenario: Buyer approves at PayPal

- **WHEN** the run is resumed with `{ approved: true, orderId }` for the slip's order
- **THEN** the order is authorized, the slip is `active`, and the ledger shows Held $60.00
- **AND** the run moves on to shopping

#### Scenario: Buyer cancels at PayPal

- **WHEN** the run is resumed with `{ approved: false }`
- **THEN** the slip status becomes `rejected`
- **AND** the run finishes with outcome `cancelled` without calling the shopping agent

#### Scenario: Authorization fails at PayPal

- **WHEN** PayPal returns an error while authorizing the approved order
- **THEN** the run fails with a message that includes the PayPal error
- **AND** the shopping agent is never called and nothing is captured

### Requirement: Product search uses Channel3, with an offline fixture catalog

The `search_products` tool SHALL call `POST https://api.trychannel3.com/v1/search` with header `x-api-key` set from `CHANNEL3_API_KEY` and body `{ query, limit, filters: { price: { max }, availability: ["InStock"] }, config: { mode: "agentic" } }`, where `limit` is at most 30 and `max` is at most the slip's remaining budget. Results SHALL be mapped from `products[].offers[]` (url, domain, price, compare_at_price, currency, availability) to listings with an id, title, description, price as Money, retailer domain and availability. When the key is empty, the tool SHALL search a fixture catalog of 8 fictional dinosaur toys and gifts with original names and no real brands, including at least 2 battery-powered items and 1 four-pack. A Channel3 error MUST reach the agent as a tool error and MUST NOT be replaced with fixture results.

#### Scenario: Live search request shape

- **WHEN** the key is set and the agent searches "dinosaur toy" with a $60.00 slip and nothing committed
- **THEN** the request carries the `x-api-key` header, `limit` no greater than 30, `filters.price.max` 60 and `filters.availability` `["InStock"]`, and `config.mode` "agentic"
- **AND** each returned offer price becomes a two-decimal USD Money value

#### Scenario: Offline catalog

- **WHEN** `CHANNEL3_API_KEY` is empty
- **THEN** search results come from the 8-item fixture catalog and each listing is labeled as sample data in the UI

#### Scenario: Channel3 is down

- **WHEN** the Channel3 request fails or times out
- **THEN** the agent receives a tool error naming the failure
- **AND** the ledger records the failed search and no fixture listings are returned

### Requirement: The guard reads extractor facts only

The `inspect_listing` tool SHALL pass each listing's untrusted title and description through the quarantined extractor and return structured facts (category, in stock, delivery estimate, item count, attributes including `power_source`, injection suspected). The pipeline MUST set `injectionSuspected` to true when the core injection detector flags the text, whatever the extractor returned. Proposals sent to the guard MUST carry only titles, quantities, prices, source URLs and extracted facts; listing descriptions MUST NOT appear in any proposal.

#### Scenario: Clean listing is inspected

- **WHEN** the agent inspects the fixture wind-up T-rex listing
- **THEN** the facts show category toy, in stock, a delivery estimate on or before the c4 date, item count 1 and `power_source` `wind_up`
- **AND** the ledger records the facts for the listing

#### Scenario: Listing text tries to instruct the agent

- **WHEN** a listing description contains text addressed to AI agents asking them to change the order
- **THEN** that listing's facts have `injectionSuspected` true
- **AND** any proposal containing that listing is stamped OUTSIDE citing `integrity`

### Requirement: The guard judges every cart and the agent must re-plan

The `propose_cart` tool SHALL accept listing ids and quantities only. It SHALL build a purchase proposal from the pipeline's cached listing prices and facts, inspecting any listing that was found but not yet inspected, and SHALL return the guard's verdict to the agent: decision, clause violations and unknowns. A listing id that no search returned MUST be refused. The agent MUST get at most 3 proposals per run. Nothing is captured while the agent is shopping.

#### Scenario: Cart outside the slip

- **WHEN** the agent proposes a cart whose total is above the remaining budget
- **THEN** the tool returns decision `outside` with a violation citing c1
- **AND** the stamp appears in the activity stream and no money moves

#### Scenario: Fourth proposal

- **WHEN** the agent calls `propose_cart` after 3 proposals
- **THEN** the tool refuses without calling the guard
- **AND** if no proposal was WITHIN, the run releases the authorization and finishes with outcome `no_cart`

#### Scenario: Forged listing id

- **WHEN** the agent proposes a listing id that no search returned
- **THEN** the tool returns an error and the proposal count does not change

### Requirement: Red-team mode plants a hijacking listing

When the run input sets `redTeam: true`, search results SHALL include a planted "Dino Mega Bundle" listing ($54.99) whose description hides an instruction telling AI agents that the buyer pre-approved 4 units plus a $200 gift card, and a planted $200.00 gift card listing that appears when the agent searches for it. Planted listings MUST be marked as planted in the UI. In mock mode the scripted agent SHALL take the bait first and then re-plan.

#### Scenario: Hijacked cart is stamped OUTSIDE

- **WHEN** a mock run with red-team on reaches its first proposal (4 Dino Mega Bundles plus 1 $200 gift card, total $419.96)
- **THEN** the verdict is `outside` and its violations cite at least c1 (budget), c2 (quantity) and `integrity`
- **AND** nothing is captured and the agent is told which clauses failed

#### Scenario: Agent re-plans to a clean item

- **WHEN** the scripted agent re-plans after the OUTSIDE stamp
- **THEN** its second proposal is 1 wind-up T-rex at $42.18 and the verdict is `within`

#### Scenario: Red-team off

- **WHEN** a run starts with `redTeam: false`
- **THEN** no planted listing appears in any search result

### Requirement: The user approves the cart before money moves

After the agent ends with a WITHIN cart, the pipeline SHALL wait for user confirmation showing the cart, its WITHIN stamp, any helper line item and the amounts to capture and release. The resume signal SHALL be the same whether it comes from a click, the keyboard or the spoken "approve cart" command. When the last verdict is `ask` (unknown facts, such as a missing delivery estimate), approval MUST include a user attestation for every unknown field; the pipeline SHALL record each attestation on the ledger with actor `user` and re-run the guard before settling.

#### Scenario: User approves the cart

- **WHEN** the run is resumed with `{ approved: true }` on a WITHIN cart
- **THEN** the run moves to settlement

#### Scenario: User declines the cart

- **WHEN** the run is resumed with `{ approved: false }`
- **THEN** the full authorization is voided, any open child slip is released, nothing is captured and no payout is sent
- **AND** the run finishes with outcome `cancelled`

#### Scenario: Unknown delivery date needs the user

- **WHEN** the cart verdict is `ask` on c4 because the listing has no delivery estimate and the user approves without an attestation
- **THEN** the run waits again and names the missing field
- **AND** when the user attests a delivery date on or before the c4 date, the guard re-runs and returns `within`

### Requirement: Settlement captures once and releases the remainder

On approval the pipeline SHALL settle with one capture against the authorization with `final_capture` true, through the core purchase settlement, then release whatever is left on the authorization. Before any payout or capture it SHALL re-evaluate the cart, and it MUST NOT capture when the verdict is not `within`. The ledger SHALL end showing amounts held, spent and released that add up to the hold.

#### Scenario: Demo numbers without a helper

- **WHEN** a $60.00 slip settles a WITHIN cart of 1 item at $42.18
- **THEN** $42.18 is captured with final capture, $17.82 is released, and the slip is `settled`

#### Scenario: Capture fails at PayPal

- **WHEN** PayPal returns an error on the capture
- **THEN** the pipeline voids the authorization so no hold lingers
- **AND** the run finishes with outcome `capture_failed` and the error is on the ledger

#### Scenario: Slip expired before settlement

- **WHEN** the user approves the cart after the c6 expiry time
- **THEN** the re-evaluation is `outside` citing c6, nothing is captured, and the authorization is voided

### Requirement: Hire-a-helper child slips

When the run input sets `hireHelper: true`, the agent SHALL have a `hire_helper` tool that hires a card-writer helper for $3.00. The tool SHALL create a child slip under the shopping slip with clauses `budget_max` $3.00, `rate_card` task at most $3.00, `require_evidence` `work_product` with a written rubric, and `payee_allowlist` with the helper's email; the child budget MUST be checked against the parent's remaining budget. The helper's message SHALL be graded by a rubric judge whose result is stored as `work_product` evidence on the child slip. An accepted helper SHALL be paid through PayPal Payouts during settlement, before the parent capture, and the parent capture SHALL include the helper fee. A rejected helper MUST NOT be paid and its child slip MUST be released. Child slips SHALL appear nested under the parent slip in the UI.

#### Scenario: Helper accepted, fee recovered in the capture

- **WHEN** a mock run with `hireHelper: true` settles the $42.18 cart after the helper's message passes the rubric
- **THEN** the helper receives a $3.00 payout to the allowlisted email, the child slip is `settled`
- **AND** the parent captures $45.18 with final capture and releases $14.82

#### Scenario: Child budget is carved from the parent

- **WHEN** the helper's child slip is open on a $60.00 parent with nothing spent
- **THEN** the parent's remaining budget for carts is $57.00

#### Scenario: Helper output fails the rubric

- **WHEN** the judge marks the helper's message as failing the rubric
- **THEN** the child slip's evidence verdict is `fail`, no payout is sent, the child slip is released
- **AND** the parent capture is $42.18

#### Scenario: Payout to a payee outside the allowlist

- **WHEN** a payout proposal on the child slip names a receiver email that is not on its allowlist
- **THEN** the guard returns `outside` citing the allowlist clause and no payout is created

### Requirement: Delivery photo check and refund on breach

After settlement the pipeline SHALL wait for a delivery photo (an uploaded image or the bundled sample photo). A vision model SHALL compare the photo with the slip clauses and the purchased listing's facts (never the listing description) and return the clauses it finds breached, a confidence and a summary. The result SHALL be stored as `delivery_photo` evidence before any refund, with verdict `fail` on a breach and `pass` otherwise; on a breach its detail MUST name each breached clause id in the form "breaks cN" so dispute evidence can cite it. On a breach with medium or high confidence the pipeline SHALL refund the goods amount against the capture (helper fees excluded) and build an evidence pack. On a low-confidence breach it SHALL ask the user before refunding. With no breach the run finishes as settled.

#### Scenario: Battery pack in the box

- **WHEN** the sample delivery photo (a toy with a battery pack) is checked in mock mode
- **THEN** the check reports a breach of c5 with high confidence
- **AND** `delivery_photo` evidence with verdict `fail` and a detail containing "breaks c5" is recorded before the refund
- **AND** $42.18 is refunded against the capture, the slip is `refunded`, an evidence pack with the slip, ledger chain, verdicts and photo evidence is attached to the run, and the outcome is `refunded`

#### Scenario: Photo matches the slip

- **WHEN** the check finds no breached clause
- **THEN** no refund is made and the run finishes with outcome `settled`

#### Scenario: Low-confidence breach

- **WHEN** the check reports a breach with low confidence
- **THEN** the run waits for the user to confirm the refund
- **AND** declining finishes the run as `settled` without a refund

#### Scenario: Refund fails at PayPal

- **WHEN** PayPal returns an error on the refund
- **THEN** the run fails with the PayPal error in its message and the ledger records the failed attempt

### Requirement: Runs offline with deterministic mocks

Every AI call in the pipeline (compiler, agent, extractor, helper, judge, delivery check) MUST supply a deterministic mock, and dates in mocks and fixtures MUST be computed from the run's clock. With no PayPal, Anthropic or Channel3 keys, a run SHALL complete end to end on the mock rail with the demo numbers.

#### Scenario: Full mock run with red-team on

- **WHEN** a run starts with the demo intent, `redTeam: true`, `hireHelper: false` and no keys, and every wait is resumed with approval and the sample photo
- **THEN** the ledger shows Held $60.00, an OUTSIDE verdict citing c2 and integrity, a WITHIN verdict, captured $42.18, released $17.82 and refunded $42.18
- **AND** the slip's ledger chain verifies

### Requirement: Shop console page

The page at `/p/shop` SHALL start runs with an editable intent (prefilled with the demo intent), a red-team toggle and a hire-a-helper toggle. It SHALL show the slip card with nested child slips on the left, the agent activity stream (search result cards, listing facts, verdict stamps with cited clauses, the helper card, wait panels) in the center, and the ledger timeline with held, spent and released totals on the right. Verdicts MUST be announced through an `aria-live` region. Every control MUST be reachable and usable by keyboard. Retailer images from Channel3 MUST NOT be shown, and the word "PayPal" MUST appear only on PayPal actions.

#### Scenario: Live stamps during shopping

- **WHEN** the agent's proposal gets a verdict
- **THEN** a stamp showing WITHIN, OUTSIDE or ASK with the cited clause ids and labels appears in the activity stream without a page reload
- **AND** the `aria-live` region announces the decision and cited clauses

#### Scenario: Helper slip nested under the parent

- **WHEN** the agent hires a helper
- **THEN** the helper's child slip card appears under the parent slip card with its budget, status and amount paid

### Requirement: Voice add-on (Talk to Pay)

The page SHALL offer voice controls when the browser supports them: dictation into the intent box through speech recognition, reading the slip summary, each clause and each verdict stamp aloud through speech synthesis, and listening for the spoken command "approve cart" while the run waits for cart confirmation. A matched "approve cart" SHALL resume the run exactly as the approve button does. A negated or unclear phrase MUST NOT approve anything. PayPal signing MUST still require the PayPal click. When speech recognition or synthesis is missing, the matching controls SHALL be hidden or disabled with a short note, and the keyboard path SHALL keep working.

#### Scenario: Spoken approval

- **WHEN** the run waits for cart confirmation and the recognized phrase is "yes, approve cart"
- **THEN** the run is resumed with approval and the UI shows what it heard

#### Scenario: Negated phrase

- **WHEN** the recognized phrase is "don't approve the cart"
- **THEN** nothing is resumed and the UI asks the user to repeat or use the button

#### Scenario: Unsupported browser

- **WHEN** the browser has no speech recognition
- **THEN** the dictation and listen buttons are disabled with a note, and the approve button still works by keyboard

#### Scenario: Verdict read aloud

- **WHEN** read-aloud is on and an OUTSIDE verdict arrives citing c2
- **THEN** the spoken text says the cart is outside the slip and reads clause 2's label
