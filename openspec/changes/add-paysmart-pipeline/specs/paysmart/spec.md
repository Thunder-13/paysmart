# Spec delta: paysmart

## Purpose

One plain-words input box. Shopping asks are searched, screened and turned into guard-stamped carts that the person chooses between before PayPal moves money. Other asks go to the pipeline built for them.

## ADDED Requirements

### Requirement: The router sends each ask to one use case

The `understand` step SHALL classify the ask into exactly one of `buy`, `pay_person`, `group_buy`, `cash_check`, `paid_research` or `dispute` with one no-tool `ai.json` call that has a deterministic mock. A non-buy ask MUST end the run with outcome `handed_off`, a handoff naming the target pipeline and path, no slip and no PayPal call. After the model answers, a deterministic check SHALL send any ask that contains a Friends and Family, off-platform or advance-fee phrase to `pay_person` and quote the matching lines.

#### Scenario: Each example ask lands on its route

- **WHEN** each of the six `PAYSMART_EXAMPLES` runs in mock mode
- **THEN** the demo ask routes to `buy` and waits at `choose`
- **AND** the other five end `handed_off` to `/p/second-look`, `/p/bounty`, `/p/cash-weather`, `/p/toll-road` and `/p/dispute-desk` in that order
- **AND** the mock rail logged zero calls

#### Scenario: A scam phrase overrides a model that says buy

- **WHEN** the model answers `buy` for an ask that says the seller wants Friends and Family
- **THEN** the use case becomes `pay_person` and the handoff quotes the matching line

#### Scenario: A buy ask with nothing to look for asks a question

- **WHEN** a buy ask yields no needs
- **THEN** the run waits at `clarify` with the question "What should I look for?"
- **AND** after 2 unanswered rounds the run ends `blocked` with the last question in `note`

### Requirement: The request screen runs before any search

After `compile` and before `discover`, the `screen_request` step SHALL check that the slip is valid, that its limit is at most $1,000.00, that its expiry is inside 29 days and that `category_in` exists and omits `gift_card` unless the ask names a gift card. A failure MUST send a clarify question to the person and MUST NOT search or call PayPal. The replaced slip SHALL be rejected with a `slip.status` event.

#### Scenario: No budget in the ask

- **WHEN** the ask names no amount
- **THEN** the run waits at `clarify` asking how much the person can spend
- **AND** no search ran and the mock rail logged zero calls

#### Scenario: Limit over the cap

- **WHEN** the ask says "under $5,000"
- **THEN** the run waits at `clarify` with the $1,000.00 cap in the question

#### Scenario: Gift card the person did not ask for

- **WHEN** the compiler returns a `category_in` clause that includes `gift_card` and the ask never says gift card
- **THEN** the run waits at `clarify` and no search ran

#### Scenario: Answer resumes with a fresh slip

- **WHEN** the person answers "$60" at `clarify`
- **THEN** the first slip is rejected, a new slip is created with a $60.00 `budget_max`, and the run continues to `discover`

### Requirement: PaySmart runs one visible search per need

The `discover` step SHALL run one search per need from the router, one need per step, and SHALL save the run state after each search so the person sees every search as it lands. Each search SHALL be recorded as a `SearchRun` with the need, the query, the source, the counts of listings found, ruled out, shown and inspected, and the listing ids, plus a `paysmart.search` ledger event with a plain-words message. A Channel3 error SHALL fall back to the sample catalog for that search and the event message MUST say so. A listing already on the board keeps its first need. The ask MAY arrive by voice; `askVia` SHALL be recorded in the `paysmart.routed` ledger event and SHALL NOT change how the ask is handled.

#### Scenario: Demo ask runs two searches

- **WHEN** the demo ask runs in mock mode
- **THEN** `state.searches` holds "dinosaur gift" with 9 found, 1 ruled out, 8 shown, 5 inspected and "birthday card" with 2 found, 0 ruled out, 2 shown, 2 inspected
- **AND** the ledger has two `paysmart.search` events

#### Scenario: State is saved between needs

- **WHEN** the `discover` step runs once for a two-need ask
- **THEN** it returns `next: "discover"` with `discoverCursor` 1 and exactly one search saved
- **AND** the second call returns `next: "assemble"` with two searches

#### Scenario: Channel3 error falls back

- **WHEN** the Channel3 request fails during a search
- **THEN** the search is recorded with source `fixtures` and the ledger message names the failure

#### Scenario: Voice ask

- **WHEN** a run starts with `askVia` "voice"
- **THEN** the `paysmart.routed` event records `askVia` "voice" and the run continues exactly as for a typed ask

### Requirement: Every listing is screened before the agent sees it

`discover` SHALL run an integrity screen (injection detection on title and description) and a seller screen (Second Look detectors on title and description) on every new listing. A listing that fails either screen MUST NOT appear in the agent's task text or in any tool result, and no text from it SHALL reach the agent. It SHALL stay on the board with the failing screen, the plain-words reason and the quoted line. Facts SHALL come only from the quarantined extractor. The guard SHALL NOT read listing descriptions; the one listing string it reads is the item title, in the fail-safe multi-pack check, which can only move a verdict to ask.

#### Scenario: Scam seller is ruled out with a quote

- **WHEN** the demo ask runs in mock mode
- **THEN** the marketplace T-Rex has status `ruled_out`, a failed `seller` screen naming Friends and Family request and Off-platform payment, and the quoted line "Pay me by friends and family or Zelle so we skip fees."
- **AND** it is absent from the agent's task text

#### Scenario: Injection listing is ruled out

- **WHEN** the red-team demo runs and the search returns Shop's planted bundle
- **THEN** the bundle has a failed `integrity` screen and never reaches the agent
- **AND** a `propose_cart` call naming it gets a tool error and creates no option

#### Scenario: Agent cannot name a ruled-out seller

- **WHEN** the mock agent calls `inspect_listing` and `propose_cart` with the scam seller's id
- **THEN** both return an error text, no option exists for it, and nothing is captured for it

### Requirement: The cart agent builds from screened products and cannot search

The `assemble` agent SHALL have only `inspect_listing` and `propose_cart`. `inspect_listing` SHALL open only eligible listings that discovery did not open, through the quarantined extractor. `propose_cart` SHALL accept only opened listings that no screen ruled out.

#### Scenario: No search tool

- **WHEN** the `assemble` step starts the agent
- **THEN** the tool list is exactly `inspect_listing` and `propose_cart`

#### Scenario: Unopened listing

- **WHEN** the agent proposes a cart that includes a listing nobody opened
- **THEN** the tool returns an error, no proposal is counted and no option is created

### Requirement: Mock mode builds carts for any ask

When AI runs in mock mode and the board does not hold every listing the demo script names, the `assemble` step SHALL build its mock script from the board. Candidates for a need SHALL be the inspected, trusted products from that need's search whose slip stamp passes, in result order. Cart A SHALL take the first candidate per need, cart B the cheapest per need, and cart C the second per need when every need that has candidates has a second one. A cart that repeats an earlier set of listings MUST be skipped. A need with no candidate whose slip stamp passes SHALL fall back to its inspected, trusted products whose slip stamp is `ask`, with the same ordering rules and never a product stamped `fail`; the rationale MUST name the unknown facts in plain words. A need with no candidate at all SHALL be left out and the rationale MUST say so. Every cart SHALL go through the real `propose_cart` tool so the guard stamps it. When the board holds the demo listings, the scripted demo path SHALL run unchanged.

#### Scenario: Single-need ask that is not the demo

- **WHEN** the ask "A dinosaur book under $20, arrives by Saturday" runs in mock mode
- **THEN** the run waits at `choose` with a `within` option for "The Big Book of Tiny Dinosaurs" at $14.99
- **AND** approving it on PayPal ends the run `paid` with $14.99 held, captured and $0.00 released

#### Scenario: Channel3 listings in mock AI mode

- **WHEN** Channel3 returns three in-stock toys at $30.00, $20.00 and $12.00 and AI is in mock mode
- **THEN** the options are the $30.00 listing (best match), the $12.00 listing (lowest price) and the $20.00 listing, each stamped `within`

#### Scenario: Unknown facts fall back to ask-stamped products

- **WHEN** Channel3 returns one toy whose delivery date and power source are unknown, the ask has a delivery date and a no-batteries clause, and AI is in mock mode
- **THEN** the run waits at `choose` with one option stamped `ask` and the rationale says "Delivery date unknown for this listing; you confirm it before paying."
- **AND** resuming with attestations for `deliveryEstimate` and `attributes.power_source` makes the cart `within` and the run ends `paid`

#### Scenario: Passing products win over ask-stamped ones

- **WHEN** a need has one product stamped `pass` and one stamped `ask`
- **THEN** only the `pass` product is used in carts

#### Scenario: A need with no candidate

- **WHEN** one need has no product that passes the screens and the slip
- **THEN** the carts cover the other needs and the rationale says "No zebra umbrella passed the screens."
- **AND** when no need has a candidate, nothing is proposed and the run ends `no_options`

#### Scenario: Demo path unchanged

- **WHEN** the demo ask runs in mock mode
- **THEN** option 1 is $47.17 and option 2 is $26.39 as before

### Requirement: Carts are guard-stamped and the person chooses

`propose_cart` SHALL build a purchase proposal and evaluate it with the guard. A WITHIN or ASK cart SHALL become an option (at most 3) and an OUTSIDE cart SHALL be recorded as ruled out with the clause ids it broke. The `choose` wait SHALL carry the options, ruled-out carts, funnel, clauses and limit. The agent's rationale MUST be shown and MUST NOT be evaluated.

#### Scenario: Demo run offers two options and rules one cart out

- **WHEN** the demo ask runs in mock mode
- **THEN** the run waits at `choose` with the funnel found 11, clean 11, trusted 10, within slip 3, in carts 3
- **AND** option 1 "Clockwork Rex Wind-Up Walking Dinosaur, tin edition" plus "Pop-Up Dinosaur Birthday Card" at $47.17 and option 2 "Dig-a-Saur Triceratops Fossil Dig Kit" plus the same card at $26.39, both `within`
- **AND** the cart with the battery sound card is ruled out citing the battery clause

#### Scenario: Battery card cart is stamped OUTSIDE

- **WHEN** the agent proposes the gift plus the battery sound card
- **THEN** the guard verdict is `outside` and cites the `exclude_attribute` clause

#### Scenario: Edited clauses re-stamp everything without a new search

- **WHEN** the person resumes `choose` with the budget clause lowered to $30.00
- **THEN** option 1 moves to ruled out, option 2 stays, a `paysmart.clauses_edited` event is recorded and no search ran
- **AND** the run waits at `choose` again

#### Scenario: Forged option id

- **WHEN** the person resumes with `optionId` "opt-99"
- **THEN** the run waits again with a message that the option is not on the list and no PayPal call was made

### Requirement: Declining or abandoning moves no money

No PayPal call SHALL happen before the person picks a cart and approves it on PayPal. A decline at `choose` MUST end the run `cancelled` with the slip rejected.

#### Scenario: Decline makes zero rail calls

- **WHEN** the person resumes `choose` with `{ approved: false }`
- **THEN** the run ends with outcome `cancelled`
- **AND** `MockRailControls.calls()` is empty

#### Scenario: Bad signal re-waits

- **WHEN** the person resumes `choose` with `{ nonsense: 1 }`
- **THEN** the run waits at `choose` again with the message "Pick an option or decline." and no error

### Requirement: PayPal holds exactly the chosen cart and the guard re-checks

After the choice the `sign` step SHALL size the hold to the chosen cart's total, record `paysmart.hold_sized`, and start an AUTHORIZE order for that amount. The `pay` step SHALL call `settlePurchase` with `finalCapture: true`, which re-runs the guard, and SHALL release any remainder. The run SHALL end `paid` only after the capture succeeds.

#### Scenario: Demo purchase

- **WHEN** the person picks option 1 and approves on PayPal
- **THEN** the order is authorized for $47.17, $47.17 is captured with `final_capture` true and $0.00 is released
- **AND** the run waits at `aftercare` and the ledger chain verifies

#### Scenario: Option 2 purchase

- **WHEN** the person picks option 2
- **THEN** the hold and the capture are both $26.39

#### Scenario: Declined on PayPal

- **WHEN** the person cancels on PayPal
- **THEN** the slip is rejected and the run ends `cancelled` with no capture

#### Scenario: PayPal capture error

- **WHEN** the capture call throws
- **THEN** the remainder is voided, a `paysmart.capture_failed` event is recorded and the run ends `capture_failed` with the error in `note`

#### Scenario: Guard blocks at the capture

- **WHEN** the slip expires between the choice and the capture
- **THEN** the guard stamps the cart OUTSIDE, nothing is captured, the hold is voided and the run ends `blocked`

### Requirement: Delivery is checked and a breach refunds

After the capture the run SHALL wait for a delivery photo (or a skip) and check it with Shop's delivery helpers. A high-confidence breach SHALL refund the captured amount. A lower-confidence breach SHALL ask the person first.

#### Scenario: Skip

- **WHEN** the person skips the delivery check
- **THEN** the run ends `paid`

#### Scenario: Sample photo breaches the battery clause

- **WHEN** the person uses the sample photo on a slip with the battery clause
- **THEN** the full captured amount is refunded and the run ends `refunded`

### Requirement: Payments are findable for disputes

A PaySmart slip SHALL own its capture id so a dispute on that capture finds the slip and its hash-chained evidence.

#### Scenario: Dispute Desk lookup

- **WHEN** `linkDispute` runs on the capture id of a paid PaySmart run
- **THEN** the link method is `capture` and the slip id is the PaySmart slip
