# Design: add-core-platform

## Context

See proposal.md for the motivation. The shape of the system is fixed by `src/core/contracts.ts` (frozen): pipelines are `PipelineDefinition`s whose steps receive a `StepContext` with the rail, AI, extractor, guard, store and `CoreServices`. Six pipeline agents build against this change in parallel, so module names and component props are locked once published. Next.js 16 runs with `cacheComponents: true`, which forbids the `dynamic` route segment config and prerenders anything that does not read request data.

## Goals / Non-Goals

**Goals:**
- Money moves only through CoreServices, and only after a "within" verdict.
- Every pipeline runs end to end offline (mock rail, mock AI) and against the PayPal sandbox and Claude when keys exist, with no code changes.
- Every state change that matters for a dispute is in a verifiable hash chain.

**Non-Goals:**
- A job queue or multi-process coordination; one Node process owns runs.
- Durable mock rail state.

## Pipeline step graph (reference flow every pipeline composes)

The core does not own a pipeline, but every pipeline uses the same signing and settlement pattern. The orchestrator drives it like this:

```
start(input)
  compile        core.compileSlip            (ai.json smart)                 -> next sign
  sign           core.createSlip, core.beginSigning
                                              rail.createOrder                -> wait paypal_approval, resumeAt signed
                   [buyer approves on PayPal or /mock-paypal/approve]
                   GET /api/paypal/return  -> resume {approved: true, orderId}
                   GET /api/paypal/cancel  -> slip rejected, resume {approved: false, orderId}
  signed         signal.approved ? core.completeSigning                         -> next act
                                   rail.getOrder, rail.authorizeOrder (AUTHORIZE)
                                   rail.getOrder, rail.captureOrder   (CAPTURE)
                 : fail "declined"
  act            extractor.extract (ai.json fast, no tools), core.evaluate      -> next settle | wait user_confirm (ask)
  settle         core.settlePurchase   rail.captureAuthorization                -> next close
                 core.settlePayout     rail.createPayout
                 core.createChildSlip  (guard only)
  close          core.releaseRemainder rail.voidAuthorization                   -> done
  dispute        core.evidencePack (ai.text fast), rail.provideEvidence / acceptClaim (pipeline-owned events)
```

| Step | CoreServices | PayPalRail |
|---|---|---|
| compile | compileSlip | none |
| sign | createSlip, beginSigning | createOrder |
| signed | completeSigning | getOrder, authorizeOrder or captureOrder |
| act | evaluate | none |
| settle | settlePurchase, settlePayout, createChildSlip | captureAuthorization, createPayout |
| close | releaseRemainder, refund | voidAuthorization, refundCapture |
| evidence | addEvidence, evidencePack | none (pipelines call provideEvidence, addTracking directly and log their own events) |

Run events ("run.step", "run.waiting", "run.done", "run.failed") land on the run's slip chain once a step returns a slipId.

## Decisions

1. **Guard is a pure function over facts, not text.** It never sees listing descriptions or model output. It decides on `ExtractedFacts` and amounts; the item title is read only by a fixed multi-pack pattern that can raise `ask`, and is quoted in messages. Alternative considered: let the model judge the proposal. Rejected because a prompt-injected listing could then talk its way past the slip. The extractor's worst case is wrong facts, which the guard still checks, and injection markers become an "integrity" violation.

2. **Committed spend for parents.** The guard's `spent` for a parent slip is its own spend plus each open child's budget (or a closed child's spend), minus what the parent already captured for that child. This makes helper budgets a real carve-out without a second authorization at PayPal. The parent captures the helpers' spend together with its next purchase.

3. **Hash chain per slip in SQLite.** `node:sqlite` (`DatabaseSync`) avoids a native dependency. Each slip has its own chain so verifying one dispute does not need the whole database. Canonical JSON sorts keys at every depth; data is normalized through a JSON round trip before hashing so the stored and hashed forms match. Alternative: one global chain. Rejected because a single bad row would taint every slip.

4. **Mock rail mirrors PayPal's state machine and error codes.** Tests and offline demos hit the same failure paths as the sandbox (MAX_CAPTURE_AMOUNT_EXCEEDED, AUTHORIZATION_VOIDED, PREVIOUSLY_VOIDED, REFUND_AMOUNT_EXCEEDED, DUPLICATE_INVOICE_ID). Every rail call is logged through `calls()` so tests can assert, for example, zero PayPal calls per metered fetch.

5. **Idempotency at PayPal.** Authorization captures send `PayPal-Request-Id: capture-<authId>-<proposalId>` and `invoice_id = proposalId`; payouts use `sender_batch_id = <slipId>-<n>` as both the batch id and the request id. A retried call after an ambiguous network failure cannot pay twice.

6. **Structured output without forced tool choice.** Claude Sonnet 5.5 rejects `tool_choice` "any"/"tool", so `ai.json` offers a single `submit_result` tool with `tool_choice: auto`, an explicit instruction, zod validation, and one repair turn that returns the zod errors as an `is_error` tool result. Alternative: `output_config.format` structured outputs. Rejected for now because the contract schemas use discriminated unions, regex patterns and records that the strict JSON-schema subset may not accept. Smart-tier calls on supported models send `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta.

7. **Async HTTP runs.** `begin`/`beginResume` save the run (status running) and return it; the route answers 202 and keeps the promise alive with `after()`. A promise chain per run id serializes calls. `start`/`resume` keep awaiting semantics for tests.

8. **Next 16 cacheComponents.** Route handlers export only `runtime = "nodejs"` and call `await connection()` before reading the store, because `dynamic = "force-dynamic"` is a build error under cacheComponents. Server components that read SQLite or env sit inside `<Suspense>` and call `connection()`.

9. **Runtime wiring reads at call time.** Services and the orchestrator reach the rail, AI and clock through getters on the runtime object, so `vi.spyOn(runtime.rail, ...)` and `vi.setSystemTime` affect core's own calls.

## Risks / Trade-offs

- [Background runs die with the process] → Runs are saved after every step; a restarted server shows the last saved state, and waiting runs resume normally.
- [Mock rail state is in memory] → Restarting the server in mock mode loses mock orders; the approval page says so when a token is unknown. Sandbox mode is unaffected.
- [Regex injection detector has false positives and misses] → It only adds to the model's own flag; benign phrases from real listings ("You must add batteries", "Operating system:", emoji with zero-width joiners) are covered by tests.
- [Reporting API needs the Transaction search permission] → PayPal's error name (NOT_AUTHORIZED) is kept in the message so the UI can explain the setting.
- [SSE through proxies] → `X-Accel-Buffering: no`, a 15 s heartbeat, and `Last-Event-ID` replay.

## Migration Plan

New code only. Deploy with `DATA_DIR` on a persistent disk. To roll back, remove the routes; the SQLite file can stay.
