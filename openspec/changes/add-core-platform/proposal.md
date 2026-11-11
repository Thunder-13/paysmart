# Proposal: add-core-platform

## Why

Six pipelines (shop, second-look, bounty, cash-weather, toll-road, dispute-desk) all need the same trust machinery: a signed mandate per dollar, a deterministic check before money moves, a PayPal rail that works offline and against the sandbox, and a tamper-evident record. Building it once in core lets the pipeline agents work in parallel against one frozen contract (`src/core/contracts.ts`) instead of six private copies.

## What Changes

- Money and id helpers (`@/core/money`, `@/core/ids`): integer cents, PayPal wire format, currency checks.
- The Guard (`@/core/guard`): a pure function that compares proposal facts with slip clauses for all ten clause kinds plus an integrity check for prompt injection, and returns within / outside / ask with plain-words messages that cite the clause.
- A SQLite store (`@/core/store/sqlite`) for slips, blobs, pipeline documents and a per-slip SHA-256 hash-chained ledger with live subscriptions.
- Two PayPal rails behind one interface: a typed REST client for the sandbox (`@/core/rail/sandbox`) and a stateful offline mock (`@/core/rail/mock`) with PayPal's state machine and error codes.
- The AI runtime: a Claude adapter (`@/core/ai/anthropic`) and a scripted mock (`@/core/ai/mock`) with the same `AI` interface, plus the quarantined fact extractor (`@/core/extractor`).
- CoreServices (`@/core/services`): compile, sign, evaluate, settle, pay out, release, refund, helper slips, evidence and evidence packs. Typed ledger event shapes live in `@/core/events`.
- The orchestrator (`@/core/orchestrator`): named steps that can wait on people, resume signals, a 50-step cap per call, per-run locking, and background execution for HTTP.
- Server runtime (`@/server/runtime`) chosen from env, generic API routes (runs, slips, events over SSE, blobs, PayPal return/cancel/webhook, health), and the offline approval simulator page.
- The UI kit (`@/components/*`) every pipeline page uses: AppShell, PipelineHeader, SlipCard, VerdictStamp, LedgerTimeline, MoneyTag, SignWithPayPal, EvidencePackView, FileDrop, WaitPanel, and the `run-client` hooks.

PayPal APIs exercised: OAuth2 client credentials; Orders v2 (create, get, authorize, capture, track); Payments v2 (capture authorization, void, reauthorize, refund); Payouts v1 (create, get); Reporting transactions v1; Invoicing v2 (list, remind); Disputes v1 (list, get, provide-evidence multipart, accept-claim); Webhooks (verify-webhook-signature).

AI capabilities exercised: structured output through a single submit tool validated with zod and one repair retry; plain completion; a manual tool-use loop with zod-validated tool inputs; image input as base64 blocks; server-side refusal fallback on supported models; a deterministic mock for every call.

## Capabilities

### New Capabilities

- `slip-mandates`: compiling plain words into numbered clauses, creating slips, signing them with PayPal, helper (child) slips and their budget accounting.
- `guard`: the deterministic clause checker, its decision rules, messages and the injection integrity check.
- `ledger`: the per-slip hash chain, verification, live feed, typed event shapes, and evidence packs.
- `paypal-rail`: the PayPal interface, the sandbox REST client, and the offline mock with its state machine.
- `ai-runtime`: the Claude adapter, the mock AI, and the quarantined extractor with its injection detector.
- `orchestrator`: runs, steps, waits, resumes, failure handling and the run HTTP API.
- `console-ui`: the shared UI kit, the home console, the approval simulator, and the browser run helpers.

### Modified Capabilities

None. There are no existing specs.

## Impact

- New code under `src/core/**` (except `contracts.ts`), `src/server/**`, `src/components/**`, `src/app/api/{runs,slips,events,blobs,paypal,health}/**`, `src/app/mock-paypal/**`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`.
- One additive contract change: `MockRailControls.calls()` (marked `// ADDED BY CORE:`).
- Runtime dependencies already in `package.json`: `@anthropic-ai/sdk`, `zod`, Node's built-in `node:sqlite`. No new packages.
- Env: `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `AI_MODE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_SMART`, `ANTHROPIC_MODEL_FAST`, `APP_BASE_URL`, `DATA_DIR`.

## Non-goals

- Pipeline-specific steps, pages and routes (each pipeline owns its own change).
- Multi-user accounts, login, or multi-tenant data separation.
- Production PayPal (live) credentials, PayPal partner onboarding, or Vault.
- Durable job queues: background runs live in the server process.
- Persisting the mock rail's state across server restarts.
