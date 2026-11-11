# slip-mandates

## Purpose

A Slip is the signed mandate that every dollar an AI touches must carry. This capability turns a person's plain words into numbered clauses, gets the slip signed through PayPal, settles money only inside it, and carves helper budgets out of a parent slip.

## ADDED Requirements

### Requirement: Compile plain words into numbered clauses

The system SHALL compile a person's words into a CompiledSlip whose clauses are renumbered c1..cn in order, contain exactly one budget_max clause equal to the budget, end with one expires_at clause, and carry a non-empty plain-words label on every clause. When the compiled budget and a budget_max amount disagree, the lower figure MUST win. When no valid future end time is given, the slip MUST expire 72 hours after compilation (PayPal's authorization honor period) and never later than 29 days.

#### Scenario: Duplicate budgets and a missing end time
- **WHEN** the compiler returns two budget_max clauses ($40 and $90), a label "c1: Nothing that needs batteries", and expiresAt "not a date"
- **THEN** the result has ids c1, c2, c3, a single $40.00 budget_max, the label "Nothing that needs batteries", and an expires_at clause 72 hours from now

#### Scenario: Budget and clause disagree
- **WHEN** the compiled budget is $50.00 and the budget_max clause says $45.00
- **THEN** the slip budget and its budget_max clause are both $45.00

### Requirement: Create slips with a ledger record

The system SHALL create a slip in status draft with zero spend and empty PayPal ids, and MUST append a "slip.created" event carrying the intent, principal, clauses, budget, expiry and parent id.

#### Scenario: New slip
- **WHEN** a pipeline creates a slip for "a toy under $50"
- **THEN** the slip is draft, spent is $0.00, and the slip's ledger starts with "slip.created" at seq 1

### Requirement: Sign with PayPal

The system SHALL start signing by creating a PayPal order for the slip budget with custom_id set to the slip id, return and cancel URLs at /api/paypal/return and /api/paypal/cancel carrying the slip id, store the return path in slip.meta.returnPath, set status awaiting_signature, and append "rail.order_created" and "slip.signing_started". Completing signing MUST require the order to be APPROVED. AUTHORIZE-intent slips MUST become active with an authorization id; CAPTURE-intent slips MUST be captured, settled, and have spent equal to the captured amount. Completing twice MUST NOT sign twice.

#### Scenario: Authorize-intent signing
- **WHEN** the buyer approves the order and the run completes signing
- **THEN** the slip is active, holds an authorization id, and its ledger shows "rail.authorized" then "slip.signed"

#### Scenario: Buyer has not approved
- **WHEN** completeSigning runs while the order is still CREATED
- **THEN** it fails with a message saying the order is not APPROVED and the slip stays awaiting_signature

#### Scenario: Capture-intent payment to a payee
- **WHEN** a second-look slip is signed with intent CAPTURE and payee seller@example.com
- **THEN** the order names that payee, the slip is settled, and "slip.signed" records the capture id with a null authorization id

### Requirement: Settle only inside the slip

Purchases SHALL be guarded with spent equal to the slip's committed spend, and only a "within" verdict MAY capture against the authorization, using the proposal id as PayPal invoice_id. A failed PayPal capture MUST restore the slip's previous status. A final capture MUST settle the slip and make later captures fail. Payouts SHALL rebuild the proposal items from the receivers so the guard sees exactly what is paid, MUST reject the whole batch when any receiver fails, MUST use sender_batch_id "<slipId>-<n>" and sender_item_id "<batchId>-<i>", and MUST work on slips with no PayPal order in status draft or active.

#### Scenario: Over-budget purchase
- **WHEN** $30.00 is already captured on a $50.00 slip and the agent proposes $25.00
- **THEN** the verdict is outside, no capture call reaches PayPal, and a "guard.verdict" event records the proposal

#### Scenario: Injected listing
- **WHEN** a proposal item has injectionSuspected true
- **THEN** the verdict is outside with clause "integrity" and no capture happens

#### Scenario: One bad receiver
- **WHEN** a payout lists an allowed maintainer and mallory@example.com under a payee_allowlist
- **THEN** the verdict is outside and no payout batch is created

### Requirement: Release and refund

releaseRemainder SHALL void an open authorization, mark the slip released and append "rail.voided". It MUST be a silent no-op on closed slips, after a final capture, or after a prior void, and MUST NOT throw when PayPal reports the hold was already voided or captured. A slip with no authorization in an open status MUST become released with a "slip.status" event and no PayPal call. Refunds MUST only accept capture ids that belong to the slip.

#### Scenario: Release twice
- **WHEN** releaseRemainder runs twice on an active slip
- **THEN** PayPal sees one void, the slip is released, and the ledger has one "rail.voided"

#### Scenario: Foreign capture id
- **WHEN** a refund names a capture id from another slip
- **THEN** the refund is refused before any PayPal call

### Requirement: Helper slips carved from a parent

The parent's committed spend SHALL equal its own spend plus, for each child, the child's budget while open (draft, active, settling) or its spend once closed, minus what the parent already captured for it. Creating a child MUST be guarded as a child_slip proposal for the child budget; only "within" creates an active child, adds a budget_max clause when missing, and appends "child.created" on both chains. A later parent purchase MUST capture the children's uncaptured spend with it.

#### Scenario: Helper that does not fit
- **WHEN** a $50.00 parent has a $15.00 open helper and a $40.00 helper is requested
- **THEN** the verdict is outside and no child slip is created

#### Scenario: Helper spend folded into the parent capture
- **WHEN** the helper was paid $12.00 and released, and the parent buys $30.00 with a final capture
- **THEN** PayPal captures $42.00 and the helper is marked capturedInParent
