# Design: cash-weather pipeline

## Context

See proposal.md for the why. Requirements live in `specs/cash-weather-pipeline/spec.md`; this file covers how.

Constraints that shape the approach:

- The pipeline builds against the frozen contract in `src/core/contracts.ts`. Steps get `rail`, `ai`, `guard`, `store`, `core`, `now()` and `log()` through `StepContext`. The core runtime is being built in parallel, so this design names only the locked helpers (`@/core/money`, `@/core/ids`, `@/core/guard`, `@/core/testing`, `@/server/runtime`, `@/components/run-client` and the UI kit).
- `PayPalRail` has `listTransactions`, `listInvoices`, `sendInvoiceReminder`, `createPayout` and `getPayout`, but no balance read. Today's balance is therefore a run input with a fixture default.
- Mock-only seeding lives on `MockRailControls` (`seedTransactions`, `seedInvoices`), which steps reach only by duck-typing `ctx.rail`.
- Payouts fund from Ana's own business balance, so the patronage slip has nothing for PayPal to authorize. `beginSigning` and `completeSigning` are never called.
- Owned paths: `src/pipelines/cash-weather/**`, `src/app/p/cash-weather/**`, `src/app/api/p/cash-weather/**` (one read-only `sample-input` route; runs use the generic run API), `scripts/cash-weather-*.ts`.

## Goals / Non-Goals

**Goals:**

- Every number on screen comes from pure, unit-tested functions (forecast, tone, allocation, budget). AI writes words around those numbers and never decides them.
- One slip and one ledger per run, so the LedgerTimeline tells the whole story: data sources, forecast, reminders, signature, guard verdicts, payout.
- Mock mode runs offline end to end. Sandbox mode degrades per data source with a visible notice instead of failing.

**Non-Goals:**

- Statistical rigor beyond a transparent scenario model. The bands are a planning aid; the model is documented in the UI tooltip and here.
- Persisting forecasts across runs. Run state is the record; no pipeline collection is created.
- Pipeline-specific run or resume routes; the generic run API covers both waits.

## Step graph

```
seed -> ingest -> forecast -> narrate -> upstream -> budget -> draft_slip -> nudges
                                                                              |
                     no overdue invoices: next = confirm_slip <---------------+
                                                                              |
                     WAIT user_confirm "Review reminders"                     |
                     resumeAt = send_nudges <---------------------------------+
                     signal { decisions: [{ invoiceId, action: approve|edit|skip,
                                            subject?, note? }] }
                                         |
                                         v
                                   send_nudges -> confirm_slip
                                                     |
             budget 0.00 or no receivers: done (outcome "no_room")
                                                     |
                     WAIT user_confirm "Sign the patronage slip"
                     resumeAt = pay, signal { action: sign|decline }
                                                     |
                                                     v
                                                    pay --decline--> done (slip rejected)
                                                     |---guard outside--> done (outcome "blocked")
                                                     |---Payouts error--> fail
                                                     v
                                               payout_status -> done (outcome "paid")
```

A malformed signal at `send_nudges` or `pay` returns the same wait again with a message (`{ wait, resumeAt }` pointing back at itself), so the run never advances on bad input.

## Calls per step

| Step | CoreServices | PayPalRail | AI | Other | Ledger events (on the run slip) |
|---|---|---|---|---|---|
| `seed` | none | mock only: `seedTransactions`, `seedInvoices` (MockRailControls); sandbox: none | none | fixtures built for the run date | none (no slip yet) |
| `ingest` | none | `listTransactions` x6 (30-day windows over 180 days), `listInvoices` | none | per-source fallback to fixtures | none yet; notices kept in state |
| `forecast` | none | none | none | pure `forecast()` | none yet |
| `narrate` | none | none | `ai.json` smart, label `cash-weather.narrate` | mock from forecast | none yet |
| `upstream` | none | none | `ai.text` fast, label `cash-weather.allocation` | npm registry fetch (sandbox) or fixtures; pure `allocate()` | none yet |
| `budget` | none | none | none | pure `safeToGive()` | none yet |
| `draft_slip` | `createSlip` | none | none | `store.ledger.append` | `cash-weather.data_source`, `cash-weather.forecast`, `cash-weather.allocation` |
| `nudges` | none | none | `ai.json` fast per overdue invoice, label `cash-weather.nudge` | pure `chooseTone()`, template fallback | `cash-weather.nudge_drafted` per invoice, then `run.waiting` (orchestrator) |
| `send_nudges` | none | `sendInvoiceReminder` per approved or edited rail-sourced invoice | none | signal validation | `rail.invoice_reminder`, `cash-weather.reminder_simulated`, `cash-weather.nudge_skipped`, `cash-weather.nudge_failed`, `cash-weather.signal_rejected` |
| `confirm_slip` | `releaseRemainder` (no-room path only) | none | none | none | core adds `slip.status` (released) on the no-room path |
| `pay` | `settlePayout` (one batch) | `createPayout` (inside core) | none | `store.slips.update` for status | `slip.status` (active with `in_app_confirm`, or rejected); core adds `guard.verdict`, `rail.payout_created`, `slip.status` (settled) |
| `payout_status` | none | `getPayout` per batch id | none | none | `cash-weather.payout_status` |

## Decisions

### D1. One slip per run, created before the reminder wait

The slip is created in `draft_slip`, after the forecast and allocation are known and before reminders are drafted. Reminder drafts, decisions and sends then land on the same hash-chained ledger as the payout, and the page shows one LedgerTimeline. The slip's money clauses cover payouts only; reminders are recorded actions that move no money.

Alternative considered: a separate zero-budget "watch" slip for reading the books and sending reminders, plus a patronage slip. Rejected because `Run.slipId` holds one id and two timelines split the story in a 15-second demo beat.

### D2. Clauses built in code, no `compileSlip`

Clause values come from computed numbers (budget, basis points, receiver emails, expiry), so an AI compile step would add drift and nothing else. Building them in code also means npm metadata or payer text can never add or drop a clause. Clause ids: `c1 budget_max`, `c2 split_rule`, `c3 payee_allowlist`, `c4 expires_at` (when the budget is zero: `c1 budget_max 0.00`, `c2 expires_at`). This matches the bounty and second-look pipelines.

Intent text: "Watch my cash for the next 90 days, send only the invoice reminders I approve, and give up to $150.00 this month to the maintainers of the packages my code depends on, split by how much I use them."

### D3. In-app signature, no PayPal order

On `sign`, `pay` sets the slip to `active` with `store.slips.update`, stores `meta.signedInApp = { at, by, method: "in_app_confirm" }`, and appends `slip.status` (actor `user`, reason naming `in_app_confirm`). Core's typed `slip.signed` event requires a PayPal order id, so it is not used here. On `decline` it sets `rejected` and appends `slip.status`. Slip meta also holds `{ summary, funding: "paypal_business_balance", allocation, forecastSummary, dataSources }`. Both waits also accept the generic `{approved: boolean}` signal that the shared WaitPanel sends.

### D4. Forecast model

All functions are pure and take `asOf` (the UTC calendar date of `ctx.now()`), `seed` and data; money is integer cents (`toCents` and `fromCents` at the boundary); probabilities are the only floats.

1. **Normalize.** Drop non-USD transactions (counted in a notice). Counterparty key = lowercase trimmed name.
2. **Match paid invoices** to incoming transactions (spec rule) to get `paidAt`, then payer profiles: paid count, on-time rate (3-day grace), lateness list.
3. **Recurring streams** per counterparty and direction: sort dates, take gaps, pick the cadence whose tolerance covers the median gap, require two thirds of gaps in tolerance and the minimum count. Report median amount, min and max amount, last date, interval. Transactions that feed a stream or match a paid invoice are "explained"; the rest are irregular.
4. **Irregular flow.** Net irregular cents per week over the 26 history weeks forms a bootstrap pool.
5. **Scenarios** (500, generator mulberry32 seeded with `seed`, consumed in a fixed loop order). Per scenario, for days 1 to 90:
   - Expense stream occurrences: always happen; amount uniform in the observed min..max (fixed streams have min = max); date jitter 0 days for fixed amounts, plus or minus 2 for variable ones.
   - Income stream occurrences: happen with probability 0.95; amount uniform in min..max; jitter plus or minus 2 days.
   - Outstanding SENT and UNPAID invoices: payment probability within the horizon is 0.98 (on-time rate >= 0.8), 0.9 (>= 0.5), 0.75 (< 0.5) or 0.85 (unknown). If paid, lateness is drawn from the payer's lateness list (unknown payers use the prior [0, 7, 14]) plus 0..3 days jitter; pay day = due date + lateness, and when that day has already passed, today + uniform 1..14. An outstanding invoice consumes the next projected occurrence of an income stream from the same payer when that occurrence falls within 10 days of its due date and within 10% of its amount, so retainer invoices are not counted twice.
   - Repeat clients: a payer with 3 or more invoices, a median invoicing gap of 14 to 100 days, and no recurring income stream gets its next invoices projected (median amount and terms). Each is issued with probability 0.8 and then paid like an open invoice. Without this, a project-based freelancer's forecast decays toward zero after the invoices already sent.
   - Irregular: one bootstrap draw per week, spread evenly over its days (remainder cents on the last day).
6. **Bands.** For each day, sort the 500 balances and take nearest-rank p10, p50, p90. Per invoice: share of scenarios paid by day 30 and median pay day.
7. **Weather.** Spec rule over weeks of 7 days (week 13 is days 85 to 90).

Only bands (91 x 3 integers), streams, profiles, invoice outlooks and weather go into run state; scenarios are discarded.

Alternatives considered: a closed-form mean and variance projection (cannot express lumpy, late invoices, which are the whole story); a fitted time-series or ML model (history too thin, opaque to judges, adds dependencies).

### D5. Tone is a rule; words are AI

`chooseTone(daysOverdue, profile)` implements the spec table before any model call, and the tone is passed to the model as a fixed parameter. A payer's own text can't talk a reminder down or up, and the rule is unit-testable. The drafted note must contain the invoice number and the `formatMoney` amount; otherwise the template draft (one per tone) replaces it and `cash-weather.nudge_drafted` records `{ templated: true }`.

Model tier: fast for drafts (short, one call per invoice), smart for the narrative (reasoning over the whole forecast), fast for the allocation explanation.

### D6. Untrusted text

| Source | Treatment |
|---|---|
| Transaction `note` | Never sent to any model and never rendered on the page. |
| Counterparty and invoice recipient names | Sent only inside a `<data>` block; the system prompt says the block is data, not instructions. Length-capped to 80 characters. |
| npm metadata (maintainer names and emails, funding) | Displayed as React text. Funding shown as a link only for `https:` URLs. Registry emails never become receivers. |
| User-edited reminder text | Zod-validated length, sent as the reminder note; never sent to a model. |
| Model output | Schema-validated by `ai.json`, length-capped, shown as text. |

### D7. npm registry access

Sandbox mode fetches `https://registry.npmjs.org/<name>/latest` (scoped names encode `/` as `%2f`). The version document carries `maintainers` and `funding` and weighs a few KB; the full packument at `https://registry.npmjs.org/<name>` carries the same fields but runs to megabytes (zod's measured 4.2 MB on 2026-11-08). Concurrency 4, `AbortSignal.timeout(3000)`, response parsed with a zod schema that keeps only `name`, `version`, `maintainers[].name`, `funding`. Mock mode reads `fixtures/npm-registry.json` only (one file, keyed by package name, handles without emails). `scripts/cash-weather-fixtures.ts` refreshes it from the live registry for the fixture package.json. Live mode can be turned off in sandbox with `CASH_WEATHER_NPM_LIVE=0`.

### D8. Receivers mapping

`fixtures/receivers.json` maps npm handle to sandbox receiver email. `CASH_WEATHER_RECEIVERS_JSON` (a JSON object, validated: keys are npm handles, values are emails) merges over it so the team can point handles at real sandbox personal accounts without code changes. semver's maintainers are intentionally unmapped so the page shows a "no payout route" row.

### D9. Allocation and amounts

Package weight = 1 + min(importCount, 20) / 20. Split equally over mapped maintainers, summed per handle. Basis points by largest remainder (ties by handle) so they sum to 10000. Amounts in `budget` also use largest remainder, so they sum to exactly the budget and each is the floor or ceiling of its exact share. Core's guard checks each receiver against `round(total * bps / 10000)` within one cent, where total is the batch sum; with total equal to the budget, every amount passes. (Phase A planned to round down instead; that leaves the total below the budget and can push a receiver more than a cent off the guard's expected share.) The lightest receiver under 100 cents is dropped, bps recomputed over the rest, amounts recomputed, repeated until stable.

### D10. Guarded settlement

`pay` makes one `core.settlePayout(slipId, proposal, items)` call: `proposal` is `{ kind: "payout", amount: total, payee: null, items: [] }` and `items` carries `{ receiverEmail, amount, note }` per receiver. Core rebuilds one proposal item per receiver (payee in `facts.attributes.payee`), and the guard checks every receiver against `payee_allowlist`, `split_rule`, `budget_max` and `expires_at`. If any receiver fails, core records the `outside` verdict and makes no Payouts call, and the run ends with outcome `blocked`. Otherwise one Payouts batch pays everyone, spent becomes the budget, and core settles the slip. A thrown rail error fails the run; core restores the slip status and spent stays 0.00. Phase A's pure-guard preflight and per-receiver fallback were dropped once core shipped item-level guarding.

Payout note per item: "Thank you for maintaining <packages>. From <principal name> via Permission Slip."

### D11. Mock rail seeding and fixtures

`seed` uses `asMockRail(ctx.rail)` from `@/core/rail/mock`. The mock account is shared and pre-seeded with other demo data, so in mock mode `ingest` keeps only `cw-fx-*` records and shows a notice counting the rest. The forecast is then identical whatever else the mock account holds. Fixtures are generated by a pure `buildStudioFixtures(asOf)` with dates as day offsets from the run date, so the hosted demo looks current whenever a judge opens it. Fixture ids are stable (`cw-fx-txn-001`, `cw-fx-inv-001`), so a second seed upserts rather than duplicates (the mock rail upserts by id).

Fixture studio (tuned so seed 42 gives sunny, cloudy and storm weeks; balance today defaults to 4,500.00):

- Northwind Labs: monthly retainer invoice 4,500.00, net 15, always on time.
- Kestrel Health: project invoices about every 25 days, around 2,800.00, paid 0 to 9 days late (on-time rate 0.6); one invoice 20 days overdue (tone firm). One payment note carries the injection string used in the spec scenario.
- Brightline Media: invoices around 6,200.00 every six weeks, paid 31 to 50 days late; one invoice 38 days overdue (tone final).
- Juniper Co-op: small invoices around 650.00, always on time; one invoice 6 days overdue (tone friendly).
- Expenses: owner's draw 1,800.00 every two weeks, rent 1,850.00 monthly, health insurance 412.00 monthly, cloud hosting 80 to 95 monthly, design software 54.99 monthly, quarterly estimated tax 3,900.00 (two past payments 91 days apart; the next lands on day 48 and makes week 7 a storm), irregular coworking and hardware spend.
- One EUR transaction to exercise the currency notice.
- Fixture package.json (`fixtures/studio-package.json`): Ana's CLI `tidepool` with seven direct dependencies (`commander`, `picocolors`, `pino`, `semver`, `undici`, `yaml`, `zod`) and real npm handles captured by the fixtures script on 2026-11-09.

### D12. Sandbox fallback per source

Transactions fall back when the call throws or returns fewer than 20 rows; invoices fall back when the call throws or returns none. Each source carries `source: "rail" | "fixture"`. Reminders go to PayPal only for `rail` invoices; `fixture` invoices in sandbox record a `cash-weather.reminder_simulated` event instead, so the timeline never claims a reminder was sent when it wasn't. Mixed sources are allowed: real invoices from payers with no fixture history get the unknown-history tone rule.

### D13. Page

`src/app/p/cash-weather/page.tsx` is a server component (`dynamic = "force-dynamic"`; the layout already provides AppShell) that renders `PipelineHeader` and the client component `CashWeatherConsole` (`cash-weather-console.tsx`) using `startRun`, `resumeRun` and `useRun`. Sub-components in the same folder: `WeatherStrip` (`weather-strip.tsx`: 13 cells, inline SVG glyph plus text label, date range, low p10), `BandChart` (`band-chart.tsx`: plain SVG, `viewBox="0 0 720 260"`, crosshair and tooltip on pointer or arrow keys, a weekly table view, right-edge labels spread so they never collide, band path p10 to p90, p50 polyline, dashed buffer line, zero line, storm weeks as tinted rects, `<title>` and `<desc>` naming the lowest week), `InvoiceTable` (`invoice-table.tsx`: tone chip, likelihood "64% by day 30", draft in an editable textarea, approve, edit, skip), `UpstreamTable` and `GiveReasoning` (`upstream-table.tsx`: package, npm handles, weight, share, amount via `MoneyTag`, receiver, https-only funding link), plus `SlipCard`, `VerdictStamp`, `WaitPanel` and `LedgerTimeline` from the UI kit. Colors from the conventions palette: sunny uses stamp green, cloudy amber, storm stamp red, always paired with text.

## Demo beat (15 seconds of video)

- 0 to 3 s: Run starts; the 13-week strip fills left to right. Sunny, cloudy, four sunny weeks, then red storms in weeks 7 and 8. Voice: "Cash Weather read six months of Ana's PayPal history. Week seven is a storm: quarterly tax lands while Brightline still owes her."
- 3 to 7 s: Invoice table shows three drafts tagged friendly, firm, final. Ana tweaks one line in the firm one and approves all three; the ledger ticks three "reminder sent" rows.
- 7 to 11 s: Upstream table lists her dependencies with real npm handles and percentages. The reasoning card reads "Low case on day 30, minus your buffer, 10% of that, capped at $150.00." The slip card shows four clauses.
- 11 to 15 s: She clicks Sign. A green WITHIN stamp, then the PayPal Payouts batch id and item statuses. Voice: "Know what's coming in. Then pay who you depend on."

## Real sandbox notes

- **Reporting (transaction search).** The REST app needs the Transaction search feature enabled (Developer Dashboard, app settings, Features). Without it the call returns an authorization error and the run falls back to fixtures with a notice that names the setting. Each request covers at most 31 days, so the rail is called in six 30-day windows. New transactions show up in search results only after a delay (PayPal documents up to three hours), and a fresh sandbox business account has little history, so expect the fixture notice in most sandbox demos.
- **Invoicing.** `sendInvoiceReminder` works only on real invoices in SENT, UNPAID or PARTIALLY_PAID status. To exercise it, create and send two or three invoices from the sandbox business account and run after their due dates pass. Fixture invoices are never sent to PayPal; their reminders are recorded as simulated.
- **Payouts.** Payouts come from the sandbox business account's balance. Map npm handles to real sandbox personal accounts through `CASH_WEATHER_RECEIVERS_JSON`; an email with no sandbox account gets an UNCLAIMED item. Batch status starts PENDING; `payout_status` reads it once and the page shows the status it got rather than waiting.
- **npm registry.** Public and unauthenticated. If outbound network is blocked on the host, every package uses its fixture and is flagged offline.

## Risks / Trade-offs

- [The mock rail is shared by all pipelines and pre-seeded with other demo data] -> mock mode reads only `cw-fx-*` records, with a notice; a test proves the forecast is identical with and without the default seed.
- [SlipCard prints "Not signed" for a slip with no PayPal order] -> the page adds a "Signed in the app" line under the card; a core change is requested.
- [Fixture edits can silently move or remove the storm week] -> the storm-week test pins run date 2026-11-09 and seed 42, and checks week 7 (the tax week) is a storm.
- [AI drafts can misstate the amount] -> number and amount post-check with template fallback (D5).
- [Run date drives fixture dates, so screenshots differ by day] -> tests pin the run date; the video is recorded once.
- [Simulation cost] -> 500 x 90 days x about 20 events is under 1M operations, well below 100 ms in Node.
- [Weights use floats] -> weights are not money; basis points and cents are integers before any Money is built.

## Migration Plan

Replaces the orchestrator stub at `src/pipelines/cash-weather/index.ts`; the registry entry stays as is. No data migration. Rollback: restore the stub file and delete `src/app/p/cash-weather/`.

