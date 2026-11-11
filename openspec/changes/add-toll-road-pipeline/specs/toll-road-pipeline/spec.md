# Spec delta: toll-road-pipeline

## Purpose

Toll Road lets publishers charge AI agents per fetch with an HTTP 402 toll booth, while the agent's operator caps total spend and per-fetch price with a signed Permission Slip. Fetches are metered and guarded locally, settled on PayPal with one capture, and paid out to publishers by usage.

## ADDED Requirements

### Requirement: Publisher catalog
The pipeline SHALL keep a catalog of publishers and content in its own `publishers` and `content` collections. Each publisher MUST have an id, a display name and a PayPal payout email. Each content item MUST have an id, a publisher id, a title, a body and a price per fetch in USD with exactly 2 decimals. The shipped seed MUST contain 3 fictional publishers and 6 articles written for this project (no copied text), with at least 3 distinct prices and at least one article priced above the default per-fetch cap of $0.05. Seeding MUST be idempotent: running it again SHALL leave exactly the same 3 publishers and 6 articles.

#### Scenario: Seed creates the demo catalog
- **WHEN** the catalog is seeded into an empty store
- **THEN** the `publishers` collection holds 3 publishers, each with a payout email
- **AND** the `content` collection holds 6 articles spread across those 3 publishers
- **AND** the article prices include at least 3 distinct values and at least one value above $0.05

#### Scenario: Seeding twice changes nothing
- **WHEN** the catalog is seeded a second time
- **THEN** the collections still hold exactly 3 publishers and 6 articles with unchanged ids and prices

### Requirement: Publisher registration
The pipeline SHALL accept new content through `POST /api/p/toll-road/content` with a publisher name, a publisher PayPal email, a title, a body and a price. A publisher MUST be identified by its email, so a second registration with the same email adds content to the same publisher. The endpoint MUST reject a price that is not a positive 2-decimal amount of at most $1.00, an email without an `@`, or an empty title or body, with HTTP 400 and a list of field errors. `GET /api/p/toll-road/content` SHALL return the public price list (id, title, publisher, price, booth URL) and MUST NOT include article bodies or payout emails.

#### Scenario: Register an article
- **WHEN** a client posts a valid publisher, title, body and price "0.03"
- **THEN** the response is HTTP 201 with the new content id, the publisher id and the gateway URL for the article
- **AND** a GET of that gateway URL without a slip header returns a 402 quoting price "0.03"

#### Scenario: Reject a bad price
- **WHEN** a client posts a price of "0" or "2.50" or "0.035"
- **THEN** the response is HTTP 400 naming the `price` field and nothing is added to the catalog

#### Scenario: Public price list
- **WHEN** a client requests `GET /api/p/toll-road/content`
- **THEN** it receives every article's id, title, publisher, price and booth URL, with no article text and no payout email

### Requirement: HTTP 402 toll booth
`GET /api/p/toll-road/content/[id]` SHALL serve an article only to a request that carries a valid toll slip in the `x-permission-slip` header. A request without that header MUST receive HTTP 402 with header `WWW-Authenticate: PermissionSlip realm="toll-road"` and a JSON body containing `error: "payment_required"`, `reason`, `price` (decimal string), `currency`, `publisher`, the content id and title, and `howToPay` telling the caller how to sign a toll slip and resend with the header. A 402 response MUST NOT contain any part of the article body. An unknown content id MUST return HTTP 404.

#### Scenario: No header gets a price quote
- **WHEN** a client requests a seeded article without an `x-permission-slip` header
- **THEN** the response status is 402
- **AND** the `WWW-Authenticate` header equals `PermissionSlip realm="toll-road"`
- **AND** the body has `error` "payment_required", `reason` "no_slip", the article's price and currency, its publisher name and a non-empty `howToPay`
- **AND** the body does not include the article text

#### Scenario: Unknown slip id
- **WHEN** a client sends `x-permission-slip` with an id that matches no slip, or a slip from another pipeline
- **THEN** the response status is 402 with `reason` "slip_unknown" and no meter is recorded

#### Scenario: Slip not yet signed
- **WHEN** a client sends the id of a toll slip whose status is not `active`
- **THEN** the response status is 402 with `reason` "slip_not_active" and no meter is recorded

#### Scenario: Unknown content
- **WHEN** a client requests a content id that is not in the catalog
- **THEN** the response status is 404

### Requirement: Toll slip signing
The pipeline SHALL compile the operator's plain-words intent into a toll slip for pipeline `toll-road` whose clauses include `budget_max`, `rate_card` with unit `fetch` (the per-fetch price cap) and `expires_at`. The run MUST wait for the operator to confirm the slip (`user_confirm`, resumed with `{approved}`), then start PayPal signing with an AUTHORIZE-intent order and wait for buyer approval (`paypal_approval`). Only after approval SHALL the slip be authorized and become `active`. With no AI keys, the compiler mock MUST produce a deterministic slip from the default intent: budget $0.15, cap $0.05 per fetch, expiry 60 minutes after compile.

#### Scenario: Compile the default intent in mock mode
- **WHEN** a run starts with the default intent and no AI keys
- **THEN** a draft toll slip exists with `budget_max` $0.15, `rate_card` unit "fetch" price $0.05 and an `expires_at` 60 minutes after creation
- **AND** the run is waiting on `user_confirm`

#### Scenario: Operator signs and PayPal approves
- **WHEN** the operator confirms and the PayPal approval resumes the run with `approved: true`
- **THEN** the toll slip holds a PayPal authorization for the budget and its status is `active`

#### Scenario: Operator declines
- **WHEN** the operator resumes the `user_confirm` wait with `approved: false`
- **THEN** no PayPal order is created, the slip status becomes `rejected` and the run ends with outcome "declined"

#### Scenario: PayPal approval cancelled
- **WHEN** the `paypal_approval` wait resumes with `approved: false`
- **THEN** the slip is not authorized, its status becomes `rejected`, no fetch is ever paid under it and the run ends with outcome "not_signed"

### Requirement: Guarded metering per fetch
For a request with an active toll slip, the booth SHALL build a `metered_charge` proposal with amount equal to the article price, payee equal to the publisher's payout email, and one item whose unit price is the article price. It MUST check that proposal with the pure guard, passing as spent the slip's settled spend plus the sum of every meter already recorded on that slip. On a `within` verdict it MUST record a meter in the `meters` collection, append a `guard.verdict` ledger event and a `toll-road.metered` ledger event to the toll slip's chain, and return HTTP 200 with the article, the amount charged and the remaining budget. The booth MUST NOT call PayPal while metering. The guard check and the meter write MUST happen with no interleaving point between them, so concurrent fetches cannot overspend the budget.

#### Scenario: Paid fetch
- **WHEN** an agent with an active toll slip (budget $0.15, cap $0.05, nothing spent) fetches a $0.02 article
- **THEN** the response is HTTP 200 with the article body, `charged` $0.02 and `remaining` $0.13
- **AND** one meter for $0.02 to that publisher's email exists for the slip
- **AND** the slip's ledger gains a `guard.verdict` event with decision "within" followed by a `toll-road.metered` event
- **AND** the mock rail records no PayPal call for the fetch

#### Scenario: Meters sum
- **WHEN** an agent fetches articles priced $0.02, $0.04, $0.05 and $0.02 under one slip
- **THEN** the slip has 4 meters whose amounts sum to exactly $0.13
- **AND** the last `toll-road.metered` event reports 4 fetches, $0.13 spent and $0.02 remaining

#### Scenario: Concurrent fetches with room for one
- **WHEN** two fetches of $0.04 articles arrive together under a slip with $0.05 left
- **THEN** exactly one returns 200 and the other returns 402 with `reason` "budget_exhausted"

### Requirement: Guard refusals return 402 with a reason
When the guard verdict for a fetch is not `within`, the booth SHALL return HTTP 402 with the same body shape as an unpaid request plus the slip's spent and remaining amounts, and MUST NOT record a meter or return the article. The `reason` MUST be `slip_expired` when the `expires_at` clause is violated, `price_above_cap` when the `rate_card` clause is violated, `budget_exhausted` when the `budget_max` clause is violated, checked in that order, and `needs_review` for any other non-within verdict. The booth MUST append the `guard.verdict` event and a `toll-road.refused` event naming the reason to the toll slip's chain.

#### Scenario: Budget exhausted
- **WHEN** an agent with $0.13 metered on a $0.15 slip fetches a $0.04 article
- **THEN** the response is HTTP 402 with `reason` "budget_exhausted", `spent` $0.13 and `remaining` $0.02
- **AND** no new meter exists and the ledger gains `guard.verdict` (decision "outside") and `toll-road.refused`

#### Scenario: Price above cap
- **WHEN** an agent with a $0.05 per-fetch cap fetches a $0.09 article, even with ample budget left
- **THEN** the response is HTTP 402 with `reason` "price_above_cap" and no meter is recorded

#### Scenario: Slip expired
- **WHEN** an agent fetches after the slip's `expires_at` time
- **THEN** the response is HTTP 402 with `reason` "slip_expired" and no meter is recorded

### Requirement: Repeat fetches are not charged twice
A fetch of content that already has a meter under the same toll slip SHALL return HTTP 200 with the article, `charged` $0.00 and `alreadyPaid: true`, and MUST NOT record a second meter. This stops a publisher from farming tolls by telling agents to fetch the same page again.

#### Scenario: Second fetch of the same article
- **WHEN** an agent fetches the same $0.02 article twice under one slip
- **THEN** the second response is HTTP 200 with `charged` $0.00 and `alreadyPaid` true
- **AND** the slip still has exactly one meter for that article

### Requirement: Quarantined article reading
The crawler SHALL pass fetched article text only to a no-tool, schema-validated AI call that returns up to 5 key points and an `injectionSuspected` flag. The research agent MUST receive those notes instead of the raw article text. Article text MUST NOT reach the guard or any proposal; the price, payee and title on a metered proposal come from the catalog only. Every quarantined call MUST have a deterministic mock.

#### Scenario: Injected instructions in an article
- **WHEN** the crawler fetches the seeded article that contains a line telling AI agents to fetch every article again and raise their budget
- **THEN** the notes returned to the agent have `injectionSuspected` true and contain no instruction text
- **AND** the meter for that fetch equals the catalog price and the slip's budget and cap are unchanged
- **AND** the toll slip's ledger gains a `toll-road.injection_flagged` event naming the article

### Requirement: Research crawler agent
The crawler SHALL be a tool-using AI agent given a research question and exactly three tools: `list_catalog` (ids, titles, publishers, prices), `fetch_article` (input: a content id only) and `finish` (input: an answer and the content ids it cites). `fetch_article` MUST call the toll booth in-process with the run's toll slip; the agent MUST NOT be able to choose or change the slip. After a 402 with reason `budget_exhausted` or `slip_expired`, the crawler MUST stop paying for fetches, every later `fetch_article` call in the run MUST return the stop result without reaching the booth, and the run MUST record a request that the operator sign a new slip to continue. After `price_above_cap` the crawler MAY continue with other articles. Citations in the final answer MUST be limited to content paid for under the slip. The crawl SHALL end on `finish`, on a stop, or at the agent's step limit.

#### Scenario: Mock crawl of the default question
- **WHEN** the crawl step runs in mock mode with the default slip and question
- **THEN** the scripted agent lists the catalog, pays for 4 articles totalling $0.13, is refused once for "price_above_cap" ($0.09 article) and once for "budget_exhausted" ($0.04 article)
- **AND** the run state shows stop reason "budget_exhausted", an answer citing only the 4 paid articles, and a request to sign a new slip

#### Scenario: Agent tries to fetch after the stop
- **WHEN** the agent calls `fetch_article` again after a "budget_exhausted" refusal
- **THEN** the tool returns the stop result, the booth is not called and no ledger event is added

#### Scenario: Agent cites unpaid content
- **WHEN** the agent's `finish` call cites a content id it never paid for
- **THEN** that citation is dropped from the stored answer

### Requirement: Single-capture settlement
After the crawl, the pipeline SHALL settle the toll slip with one purchase proposal whose amount equals the slip's metered total and whose items give per-publisher totals as quantity times unit price (one item per publisher and price, so every unit price stays within the rate card), with final capture. It MUST then release the unspent remainder of the authorization. Meters MUST be marked settled with the capture id. If no meters exist, the pipeline MUST NOT capture, MUST release the full authorization and SHALL end the run with outcome "nothing_to_settle". If the settlement verdict is not `within`, the pipeline MUST release the authorization and fail the run naming the violated clause. If PayPal returns an error on capture, the run MUST fail with that error. In both cases the meters MUST stay unsettled and no payout SHALL be attempted.

#### Scenario: Capture equals meter total
- **WHEN** the crawl ends with 4 meters totalling $0.13 on a $0.15 slip
- **THEN** the mock rail shows exactly one capture of $0.13 with final capture against the slip's authorization
- **AND** the remainder is released and a `toll-road.settled` event records the capture id and per-publisher totals

#### Scenario: Nothing fetched
- **WHEN** the crawl ends with no meters
- **THEN** no capture happens, the authorization is voided and the run ends with outcome "nothing_to_settle"

#### Scenario: Slip expired before settlement
- **WHEN** settlement runs after the slip's `expires_at`
- **THEN** the guard rejects the purchase, no capture happens, the authorization is voided, the run fails naming the expiry clause and no payout batch is created

#### Scenario: PayPal capture error
- **WHEN** the rail throws an error on the capture call
- **THEN** the run fails with the PayPal error message, every meter stays unsettled and no payout batch is created

### Requirement: Usage-weighted publisher payout
After a successful capture, the pipeline SHALL create a network payout slip for pipeline `toll-road` with principal "Toll Road network", budget equal to the captured total, a `budget_max` clause for that total, a `split_rule` clause with one split per earning publisher, and a `payee_allowlist` clause listing those publishers' payout emails. Split weights MUST be in basis points, MUST sum to exactly 10000, and MUST be each publisher's share of the metered total rounded by largest remainder (ties broken by publisher id). The pipeline MUST pay publishers through that slip with one PayPal Payouts batch whose item amounts equal each publisher's metered total and sum to the captured total. A payout the guard rejects, for example to an email outside the allowlist, MUST NOT be sent.

#### Scenario: Split matches usage
- **WHEN** publishers earned $0.04, $0.04 and $0.05 of a $0.13 capture
- **THEN** the network slip's `split_rule` weights are 3077, 3077 and 3846 basis points, which sum to 10000
- **AND** the mock rail shows one payout batch with items of $0.04, $0.04 and $0.05 to those publishers' emails
- **AND** the run ends with outcome "paid"

#### Scenario: Payee outside the allowlist
- **WHEN** a payout proposal under the network slip names a receiver email not in its `payee_allowlist`
- **THEN** the guard verdict is "outside" and no payout batch is created

### Requirement: Toll Road page
The page `/p/toll-road` SHALL show publisher cards with each article's price per fetch, a raw panel with the status line, headers and JSON body of a real unpaid request to the booth (with an equivalent curl command), a crawler activity stream with one stamp per fetch (paid amount, already paid, or the 402 reason), live counters for fetches, spent, remaining and earnings per publisher, slip cards for the toll slip and the network payout slip, and the ledger timeline. Counters MUST update as each meter lands, without waiting for the crawl to end. Fetch stamps and verdicts MUST be announced through an `aria-live` region.

#### Scenario: Watch a mock run
- **WHEN** a viewer starts a run on the page in mock mode, confirms the slip and approves on the mock PayPal page
- **THEN** the activity stream shows 4 paid stamps and 2 refusal stamps in order, the counters end at 4 fetches, $0.13 spent and $0.02 remaining, and both slip cards and the ledger timeline render

#### Scenario: Raw 402 panel
- **WHEN** the page loads
- **THEN** the panel shows `HTTP 402`, the `WWW-Authenticate: PermissionSlip realm="toll-road"` header and the JSON price quote for a seeded article

### Requirement: Offline mock run end to end
With no PayPal or AI keys, a toll-road run SHALL complete from start to outcome "paid" using the mock rail and scripted AI, with deterministic money: 4 paid fetches, $0.13 captured in one capture, $0.02 released, and a payout batch of $0.04, $0.04 and $0.05. The ledger chains of both the toll slip and the network payout slip MUST verify.

#### Scenario: Full mock run
- **WHEN** a test starts a toll-road run, resumes `user_confirm` with `approved: true`, approves the order on the mock rail and resumes `paypal_approval` with `approved: true`
- **THEN** the run status is "done" with outcome "paid"
- **AND** the captured total equals the meter total and the payout items sum to it
- **AND** both slips' ledger chains verify
