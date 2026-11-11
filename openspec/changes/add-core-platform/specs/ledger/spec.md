# ledger

## Purpose

The ledger is the tamper-evident record of everything that happens to a slip. Each slip has its own SHA-256 hash chain that anyone can re-verify, a live feed for the UI, and an evidence pack built from it for disputes.

## ADDED Requirements

### Requirement: Per-slip hash chain

Each appended event SHALL get the next seq for its slip (starting at 1), prevHash equal to the previous event's hash ("GENESIS" for seq 1), and hash = sha256(prevHash + canonical JSON of {seq, slipId, type, actor, at, data}) with object keys sorted at every depth.

#### Scenario: Two events
- **WHEN** two events are appended to one slip
- **THEN** the second has seq 2 and prevHash equal to the first event's hash

### Requirement: Chain verification detects tampering

verifyChain SHALL recompute every hash in seq order and MUST report the first seq whose data, type, actor, time, link or numbering does not match.

#### Scenario: Edited row
- **WHEN** the stored data of event 3 is changed directly in the database
- **THEN** verifyChain returns ok false with brokenAtSeq 3

#### Scenario: Deleted row
- **WHEN** event 2 of three is deleted
- **THEN** verifyChain returns brokenAtSeq 3

### Requirement: Who writes events

CoreServices methods SHALL append the events for what they do, using the shapes exported from `@/core/events` (for example "guard.verdict" {proposal, verdict}, "rail.captured" {captureId, amount, finalCapture}, "rail.refunded" {refundId, captureId, amount, reason}, "evidence.added" as the EvidenceRef). Raw PayPal rail methods MUST NOT write events; pipelines that call the rail directly log their own events (for example "rail.tracking_added" {captureId, trackingNumber, carrier}). `appendVerdictEvent` SHALL be exported so pipelines that call the pure guard write the same "guard.verdict" shape as CoreServices.evaluate.

#### Scenario: Direct rail call
- **WHEN** a pipeline calls ctx.rail.addTracking
- **THEN** no ledger event appears until the pipeline appends "rail.tracking_added"

### Requirement: Live feed and replay

The ledger SHALL notify subscribers of every appended event, and GET /api/events?slipId= MUST stream the slip's chain as server-sent events, then live events, with a heartbeat at least every 15 seconds and Last-Event-ID resume.

#### Scenario: Watching a run
- **WHEN** a browser subscribes to a slip while its run captures money
- **THEN** the "rail.captured" event arrives without a page reload

### Requirement: Evidence pack

evidencePack SHALL return the slip, its child slips, its events, the chain check, every guard verdict, the stored evidence, and a plain-words summary (AI-written when live, a deterministic summary in mock mode).

#### Scenario: Pack after a purchase
- **WHEN** a signed slip settles one purchase and gets tracking evidence
- **THEN** the pack shows chain ok, one within verdict, the tracking evidence, and a summary that says it was signed with PayPal
