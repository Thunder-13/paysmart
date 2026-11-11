# orchestrator

## Purpose

The orchestrator runs every pipeline as named steps that can stop and wait for a person (a PayPal signature, a confirmation, an upload) and continue later with a resume signal, recording its progress on the slip's ledger.

## ADDED Requirements

### Requirement: Start and step

start SHALL validate the input with the pipeline's zod schema (rejecting before any run is saved), build the initial state, and run steps from firstStep until a step waits, finishes or fails, merging each step's partial state and keeping any slipId a step returns. Runs MUST be stored in the core "runs" collection.

#### Scenario: Invalid input
- **WHEN** a run starts with an empty required field
- **THEN** the call is rejected with the zod message and no run is saved

### Requirement: Wait and resume

A step that returns wait SHALL leave the run waiting at resumeAt with the wait message. resume MUST only accept waiting runs, MUST pass the signal to the resumeAt step as ctx.signal (and to no later step), and MUST fail with "run <id> is <status>, not waiting" otherwise. Calls on one run MUST be serialized.

#### Scenario: Signature arrives
- **WHEN** a waiting run is resumed with {approved: true, orderId}
- **THEN** the signed step sees that signal and the run finishes

#### Scenario: Double resume
- **WHEN** two resumes for the same waiting run arrive together
- **THEN** one runs and the other fails with "not waiting"

### Requirement: Failures and the step cap

A thrown error SHALL fail the run with the error's message (a PayPalError keeps its debug_id), a {fail} result MUST fail it with that message, an unknown step MUST fail it, and more than 50 steps in one call MUST fail it.

#### Scenario: PayPal rejects a capture
- **WHEN** a step throws PayPalError with debug_id abc123
- **THEN** the run is failed and run.error contains "debug_id abc123"

#### Scenario: Endless loop
- **WHEN** a step keeps returning next to itself
- **THEN** the run fails after 50 steps

### Requirement: Run events on the slip chain

Once a run has a slipId, the orchestrator SHALL append "run.step", "run.waiting", "run.done" and "run.failed" to that slip's chain, and ctx.log lines MUST become "note" events (lines logged before the slip exists are written once it does).

#### Scenario: Logged before the slip exists
- **WHEN** a step logs a line and returns the new slipId
- **THEN** the slip's chain contains that "note" event

### Requirement: Run HTTP API

POST /api/runs and POST /api/runs/[id]/resume SHALL answer 202 with the run snapshot and keep executing in the background. GET /api/runs, GET /api/runs/[id] ({run, slip, events}) and GET /api/slips/[id] ({slip, events, children, chain}) MUST serve current state. /api/paypal/return MUST resume the slip's waiting run with {approved: true, orderId}; /api/paypal/cancel MUST first mark the slip rejected and then resume with {approved: false, orderId}; both MUST redirect to slip.meta.returnPath with run=<runId> appended using "&" when it already has a query. POST /api/paypal/webhook MUST verify the signature, find the slip by any PayPal id in the resource, append "webhook.received", move status for refunds, voids and new disputes, and ignore repeats of the same event id.

#### Scenario: Bad input over HTTP
- **WHEN** POST /api/runs names an unknown pipeline
- **THEN** the response is 400

#### Scenario: Unverified webhook
- **WHEN** a webhook fails signature verification
- **THEN** the response is 400 and nothing is written

### Requirement: Uploads

POST /api/blobs SHALL accept image/png, image/jpeg, image/webp, image/gif and application/json up to 2 MB decoded, answering {ref, contentType, bytes}; larger files MUST get 413 and other types 415. GET /api/blobs/[ref] MUST return the bytes with the stored content type and immutable cache headers.

#### Scenario: Oversized photo
- **WHEN** a 3 MB JPEG is posted
- **THEN** the response is 413 and nothing is stored
