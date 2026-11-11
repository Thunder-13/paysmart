# console-ui

## Purpose

A shared paper-slip UI kit and browser helpers so all six pipeline pages look and behave the same, plus the home console and an offline approval simulator that stands in for PayPal in mock mode.

## ADDED Requirements

### Requirement: App frame

Every page SHALL render inside AppShell: the "Permission Slip" title, mode badges "PayPal: sandbox|mock" and "AI: claude|mock" read at request time, a skip link, and navigation to /p/shop, /p/second-look, /p/bounty, /p/cash-weather, /p/toll-road and /p/dispute-desk with aria-current on the active page. Fonts MUST be system fonts and colors MUST come from the paper, ink, green, red and amber tokens.

#### Scenario: Offline demo
- **WHEN** the server runs with no keys
- **THEN** the header shows "PayPal: mock" and "AI: mock"

### Requirement: Slip card

SlipCard SHALL show the summary or the person's words, numbered clauses with their ids, Budget, Held, Spent, Released and Refunded amounts, the status, the expiry, and "Signed with PayPal · <orderId>" once signed. Released MUST equal budget minus spent once the slip is settled, released or refunded. Each require_evidence clause MUST show met, pending or failed from slip.meta.evidence.

#### Scenario: Evidence clause
- **WHEN** slip.meta.evidence has a failing delivery_photo
- **THEN** the delivery photo clause shows "failed"

### Requirement: Verdict stamp

VerdictStamp SHALL show WITHIN SLIP in green, OUTSIDE SLIP in red, or NEEDS YOUR CALL in amber as an animated rotated stamp (motion reduced when the user asks), list violations and unknowns as "c2 · <message>", and announce itself with aria-live="assertive".

#### Scenario: Blocked purchase
- **WHEN** a verdict is outside on c2
- **THEN** screen readers hear the stamp and the "c2 · ..." line

### Requirement: Live ledger and runs in the browser

LedgerTimeline SHALL stream a slip's events live with actor icons, rows with id "ledger-<seq>" that can take focus, a focusSeq option, and a "Chain verified" badge (or "Chain broken at #n") from the server's check. useRun MUST poll the run every 1.5 seconds while it is running or waiting and merge the run slip's live events; useSlipEvents MUST serve any slip; startRun and resumeRun MUST return the 202 snapshot.

#### Scenario: Tampered chain
- **WHEN** the server reports brokenAtSeq 3
- **THEN** the timeline shows "Chain broken at #3" and highlights rows from #3 on

### Requirement: People inputs

WaitPanel SHALL render the waiting message and the right control for the wait kind (Sign with PayPal for paypal_approval, Approve and Decline for user_confirm, FileDrop for user_upload), and FileDrop MUST upload to /api/blobs, show errors such as the 2 MB limit, and hand back {ref, contentType, base64}.

#### Scenario: Upload too large
- **WHEN** a person drops a 5 MB photo
- **THEN** FileDrop shows the 2 MB message and does not resume the run

### Requirement: Offline approval simulator

/mock-paypal/approve?token=<orderId> SHALL show a neutral "Sandbox simulator" screen (no PayPal branding) with the amount, description and payee, and Approve or Cancel MUST update the mock order and redirect to the order's return or cancel URL with the token, for AUTHORIZE and CAPTURE orders alike. In sandbox mode the page MUST say it is unavailable.

#### Scenario: Cancel in the simulator
- **WHEN** the buyer presses Cancel
- **THEN** the order is VOIDED and the browser lands on /api/paypal/cancel with the slip id and token

### Requirement: Home console

The home page SHALL list the six pipelines with a title, one line and a link each, and the 20 most recent ledger events read at request time.

#### Scenario: Fresh install
- **WHEN** no events exist
- **THEN** the console says nothing has happened yet
