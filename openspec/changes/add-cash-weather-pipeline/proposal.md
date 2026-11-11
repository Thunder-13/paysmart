# Proposal: add the cash-weather pipeline

## Why

Ana is a freelance developer who runs her studio on her own PayPal business account and maintains open source on the side. She can't see next month's cash: four clients pay on four different schedules, one of them is chronically late, and rent, subscriptions and quarterly tax keep landing whether or not the money came in. Her code also depends on a dozen packages whose maintainers she would like to pay, but she has no way to know how much she can afford to give without risking rent.

Cash Weather joins ideas 5 (Upstream) and 9 (Cash Weather) into one story: know what's coming in, then pay who you depend on. Each idea scored low on novelty alone. Together, under a Permission Slip, they give the platform its small-business case: an AI that reads her books, drafts the awkward emails, and gives away her money only inside a signed patronage slip that a separate guard enforces.

## What Changes

- New pipeline `cash-weather` registered under the frozen contract (`PipelineDefinition`), replacing the orchestrator stub at `src/pipelines/cash-weather/index.ts`.
- Ingest: 180 days of PayPal transactions and all invoices from the rail. In mock mode a seed step loads six months of fixture data (four clients with different payment habits, subscriptions, rent, quarterly tax, one late payer) through the mock rail's seed controls. In sandbox mode an empty or failing Reporting call falls back to the same fixtures with a visible notice.
- Forecast (deterministic, pure, unit-tested): recurring income and expense detection by counterparty cadence; payer on-time history built by matching paid invoices to incoming payments; outstanding invoices weighted by that history; the next invoices of repeat clients; a 90-day daily balance projection with p10/p50/p90 bands from a seeded scenario simulation; 13 weekly weather labels (sunny, cloudy, storm) from each week's low balance against a safety buffer.
- Narrate: a three-sentence forecast and the top three risks from a structured AI call on the smart tier, with a deterministic mock.
- Nudges: for overdue SENT/UNPAID invoices, an AI-drafted reminder whose tone (friendly, firm, final) is chosen by a deterministic rule from the payer's history. Ana approves, edits or skips each draft before anything is sent through PayPal Invoicing.
- Upstream: parse a pasted `package.json`, read maintainers and funding fields from the npm registry (offline fixtures in mock mode and as fallback), weight direct dependencies (optionally boosted by an import-count hint), and explain the allocation in plain words with an AI text call.
- Safe to give: budget = min(Ana's cap, 10% of the p10 projected surplus over her safety buffer at day 30), shown with every line of the arithmetic.
- Patronage slip: a slip with `budget_max`, `split_rule` (weights in basis points summing to 10000), `payee_allowlist` and `expires_at`. Ana confirms it in the app, then the guard checks the payout and PayPal Payouts pays the maintainers' receivers from her business balance. No PayPal order is created for this slip.
- UI page `/p/cash-weather`: 13-week weather strip, balance band chart in plain SVG, invoice table with nudge drafts, upstream allocation table, SlipCard and LedgerTimeline.
- Scripts `scripts/cash-weather-run.ts` (prints a full mock run) and `scripts/cash-weather-fixtures.ts` (refreshes npm metadata fixtures from the live registry).

PayPal APIs exercised: Reporting (transaction search) through `rail.listTransactions`; Invoicing v2 list and remind through `rail.listInvoices` and `rail.sendInvoiceReminder`; Payouts v1 create and status through `core.settlePayout` and `rail.getPayout`.

AI capabilities exercised: `ai.json` on the smart tier for the forecast narrative; `ai.json` on the fast tier for tone-matched reminder drafts; `ai.text` on the fast tier for the allocation explanation. Every call carries a deterministic mock. Payer-written text (transaction notes, counterparty names) and npm metadata are treated as untrusted data.

## Capabilities

### New Capabilities

- `cash-weather-pipeline`: Cash-flow forecast from PayPal transactions and invoices, tone-matched invoice reminders under user approval, and guarded patronage payouts to the open-source maintainers a business depends on.

### Modified Capabilities

None. The pipeline consumes `core-platform` services through the frozen contract and changes none of its requirements.

## Impact

- New code: `src/pipelines/cash-weather/**` (pipeline definition, forecast model, tone rule, upstream allocation, fixtures, tests), `src/app/p/cash-weather/**` (page and client components), `scripts/cash-weather-*.ts`.
- Runs start and resume through the generic `POST /api/runs` and `POST /api/runs/[id]/resume`. One read-only route, `GET /api/p/cash-weather/sample-input`, returns the fixture run input for demo scripts.
- Depends on core: `@/core/contracts`, `@/core/money`, `@/core/ids`, `@/core/guard`, `@/core/testing`, `@/server/runtime`, `@/components/run-client`, and the shared UI kit (AppShell, PipelineHeader, SlipCard, VerdictStamp, LedgerTimeline, MoneyTag, WaitPanel).
- New outbound network call in sandbox mode only: `https://registry.npmjs.org/<name>/latest`, with timeout and fixture fallback.
- New optional env var `CASH_WEATHER_RECEIVERS_JSON` that maps npm handles to sandbox receiver emails, merged over the bundled fixture mapping.
- No new npm dependencies. The chart is hand-written SVG and the RNG is a seeded generator in the pipeline.

## Non-goals

- Accounting, tax filing or bookkeeping exports. Quarterly tax appears only as a detected recurring outflow.
- Creating, editing or cancelling invoices. The pipeline lists invoices and sends reminders only.
- Collecting card or bank data, or pulling balances from anything other than PayPal and the user's own entry.
- Funding maintainers through GitHub Sponsors, Open Collective or any non-PayPal channel. Funding URLs are displayed as information only.
- Using maintainer emails from npm metadata as payout receivers. Receivers come only from the configured mapping.
- Transitive dependency weighting, devDependencies, or languages other than npm.
- Recurring monthly autopay. Each run produces one slip, and Ana confirms every payout.
- Multi-currency forecasting. Non-USD transactions are excluded and counted in a notice.
