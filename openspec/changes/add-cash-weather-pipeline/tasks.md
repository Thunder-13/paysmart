# Tasks

Paths are relative to the repo root. `PW` = `src/pipelines/cash-weather`, `PG` = `src/app/p/cash-weather`. Every group's typecheck check is `npx tsc --noEmit --incremental false 2>&1 | grep -E "src/(pipelines/cash-weather|app/p/cash-weather|app/api/p/cash-weather)"` printing nothing.

## 1. Scaffold and fixtures

- [x] 1.1 Create `PW/types.ts` (input schema, state, stream, profile, forecast, allocation and draft types), `PW/dates.ts` and `PW/fixtures/`; verify the typecheck check prints nothing.
- [x] 1.2 Write `scripts/cash-weather-fixtures.ts` that fetches `https://registry.npmjs.org/<name>/latest` for each fixture dependency and writes `PW/fixtures/npm-registry.json` (name, version, maintainer handles without emails, funding); verify `npx tsx scripts/cash-weather-fixtures.ts` exits 0 and lists maintainers for all seven packages.
- [x] 1.3 Write `PW/fixtures/receivers.json` mapping fixture npm handles to sandbox receiver emails, leaving semver's maintainers unmapped; verify `PW/fixtures.test.ts` asserts every value is an email and semver has no mapped maintainer.
- [x] 1.4 Implement `buildStudioFixtures(asOf)` in `PW/fixtures.ts` (four clients, owner's draw, rent, insurance, hosting, software, quarterly tax, irregular spend, one EUR transaction, injection note on a Kestrel payment, three overdue invoices, stable `cw-fx-*` ids); verify `PW/fixtures.test.ts` checks unique stable ids, all dates within 180 days before `asOf`, and overdue invoices of 6, 20 and 38 days.

## 2. Forecast model (pure)

- [x] 2.1 Implement the seeded generator in `PW/rng.ts`; verify the "seeded generator" test in `PW/forecast.test.ts` shows the same seed yields the same sequence and seeds 42 and 43 differ.
- [x] 2.2 Implement recurring detection in `PW/recurring.ts`; verify `PW/forecast.test.ts` covers monthly rent detected with typical 1850.00 and next date, one-off not a stream, irregular gaps (3, 41, 12) not a stream, and quarterly tax detected from 2 occurrences.
- [x] 2.3 Implement paid-invoice matching and payer profiles in `PW/payers.ts`; verify `PW/forecast.test.ts` covers the late payer profile (31, 38, 44, 50 days late, on-time rate 0), an unmatched PAID invoice not credited, and the 3-day grace.
- [x] 2.4 Implement the 500-scenario simulation, bands, invoice outlook and repeat-client projection in `PW/forecast.ts` using integer cents and `@/core/money`; verify `PW/forecast.test.ts` shows bands deterministic for seed 42, p10 <= p50 <= p90 every day, a late payer's 30-day probability below an on-time payer's, a retainer invoice not counted twice with its income stream, and Kestrel, Brightline and Juniper projected as repeat clients.
- [x] 2.5 Implement weekly weather labels in `PW/weather.ts`; verify `PW/forecast.test.ts` shows the storm week detected for fixture data (run date 2026-11-09, seed 42, buffer 2000.00) with week 7 a storm and at least one sunny week, plus the label rule cases.

## 3. Reminders

- [x] 3.1 Implement `chooseTone` in `PW/tone.ts`; verify `PW/nudges.test.ts` covers tone selection by payer history (6 days on-time payer friendly, 20 days 0.5 payer firm, 38 days 0-rate payer with 4 paid final), unknown payer at 10 days friendly, and any payer at 45 days final.
- [x] 3.2 Implement reminder drafting in `PW/nudges.ts` (prompt builder with a `<data>` block, `ai.json` fast with a per-tone template mock, invoice number and amount post-check); verify `PW/nudges.test.ts` shows the injection note absent from every reminder and narrative prompt and a draft missing the exact amount replaced by the template.
- [x] 3.3 Implement the reminder signal schema and parser in `PW/nudges.ts`; verify `PW/nudges.test.ts` covers per-invoice decisions with skip as default, unknown ids returned as rejected, the generic `{approved}` signal, and a 1001-character note or an edit without text refused.

## 4. Upstream and safe to give

- [x] 4.1 Implement package.json parsing in `PW/upstream.ts` (direct dependencies only, npm name rules, alphabetical cap of 50); verify `PW/upstream.test.ts` rejects `../../admin` and `evil?x=1`, keeps `zod`, and lists dependencies past 50 as skipped.
- [x] 4.2 Implement the registry client in `PW/registry.ts` (`/latest`, 3 s timeout, concurrency 4, zod subset, fixture fallback, offline flag); verify `PW/upstream.test.ts` with an injected fetch shows zero fetch calls in fixtures mode, a timed-out package falling back to its fixture flagged offline, and non-https funding links dropped.
- [x] 4.3 Implement `allocate` and `receiverMap` in `PW/allocation.ts`; verify `PW/upstream.test.ts` shows split weights sum to 10000 with and without an import hint, import counts 20 and 0 giving 2:1 within one basis point, semver listed as having no route, a planted registry email absent from every row, and bad `CASH_WEATHER_RECEIVERS_JSON` ignored.
- [x] 4.4 Implement `safeToGive`, `splitBudget` and `buildGive` in `PW/budget.ts`; verify `PW/upstream.test.ts` covers the cap binding (9000.00 low case, 2000.00 buffer, 150.00 cap), no room at 1800.00, the 87.00 split summing exactly with each amount within a cent of its share, and a sub-1.00 receiver dropped with weights renormalized to 10000.
- [x] 4.5 Implement the allocation explanation (`ai.text` fast with a deterministic mock) in `PW/upstream.ts`; verify `PW/upstream.test.ts` shows the mock text names every receiving handle with its percentage.

## 5. Pipeline definition and slip

- [x] 5.1 Implement the run input schema with defaults in `PW/types.ts`; verify `PW/pipeline.test.ts` shows defaults applied (cap 150.00, buffer 2000.00, seed 42) and invalid or oversized `packageJson` (and a non-USD cap) refused with the field named.
- [x] 5.2 Implement `seed` and `ingest` in `PW/steps/ingest.ts` (six 30-day windows, mock scoping to `cw-fx-*`, per-source sandbox fallback with notices); verify `PW/pipeline.test.ts` shows six rail calls each spanning at most 31 days, a second seed not duplicating records, a sandbox stub that throws NOT_AUTHORIZED producing fixture transactions plus a notice while keeping its real invoices, and an empty sandbox falling back for both sources.
- [x] 5.3 Implement `forecast`, `narrate`, `upstream` and `budget` in `PW/steps/plan.ts` and `PW/narrative.ts`; verify `PW/pipeline.test.ts` shows the mock narrative has at most three sentences and three risks with the first on the lowest week, a failing AI call yields the labeled fallback, and the fixture budget is 150.00.
- [x] 5.4 Implement `draft_slip` in `PW/steps/slip.ts` (clauses c1 to c4 built in code, meta, ledger events for data sources, forecast and allocation); verify `PW/pipeline.test.ts` shows clause kinds and order, `split_rule` weights summing to 10000, allowlist equal to receiver emails, expiry 7 days out, null order id, and the two-clause no-room variant ending released with no payout.
- [x] 5.5 Implement `nudges` and `send_nudges` in `PW/steps/nudges.ts` with the `user_confirm` wait and self-pointing re-wait; verify `PW/nudges.test.ts` covers approve, edit and skip sending exactly two reminders, an undrafted invoice id rejected and logged, a malformed signal re-waiting with nothing sent, a PayPal error on one reminder leaving the others sent, sample invoices recorded as simulated, and no wait when nothing is overdue.
- [x] 5.6 Implement `confirm_slip`, `pay` and `payout_status` in `PW/steps/pay.ts` (in-app signature, one guarded `core.settlePayout` batch, `rail.getPayout`); verify `PW/pay.test.ts` shows a successful batch settling the slip, the payout guard rejecting a payee not in the allowlist (verdict outside on c3, no payout, spent 0.00), a signature after expiry rejected on c4, decline setting `rejected`, an unknown signal re-waiting, and a Payouts error failing the run with spent 0.00.
- [x] 5.7 Replace the stub in `PW/index.ts` with the full definition (title, tagline, primitives, `firstStep: "seed"`, twelve steps); verify the typecheck check prints nothing and `PW/pipeline.test.ts` asserts every `next` and `resumeAt` names an existing step.

## 6. Page

- [x] 6.1 Build `PG/weather-strip.tsx` and `PG/band-chart.tsx` in plain SVG; verify `PG/components.test.ts` (rendered with `react-dom/server`) finds 13 week cells each with a text label and date range, and a chart with `<title>`, a `<desc>` naming the lowest week, a buffer line, storm marks and the weekly table view.
- [x] 6.2 Build `PG/invoice-table.tsx` and `PG/upstream-table.tsx` (`UpstreamTable`, `GiveReasoning`); verify `PG/components.test.ts` finds approve, edit and skip radios per drafted invoice, npm handles next to receivers, https-only funding links, and all six reasoning lines.
- [x] 6.3 Build `PG/page.tsx` (`dynamic = "force-dynamic"`) and `PG/cash-weather-console.tsx` with `startRun`, `useRun`, `resumeRun`, notices, `SlipCard`, `VerdictStamp`, `WaitPanel` and `LedgerTimeline`; verify the typecheck check prints nothing, `npx eslint src/app/p/cash-weather` reports no errors, and `PG/components.test.ts` renders the fallback notice.

## 7. Integration checks

- [x] 7.1 Write the full mock run test in `PW/run.test.ts` on `createTestRuntime()`: start with fixture input, approve every reminder, sign; verify the run ends done, the mock rail holds one reminder per draft and one payout item per receiver, `verifyChain` returns ok, and the forecast is identical with and without the mock rail's default seed.
- [x] 7.2 Write `scripts/cash-weather-run.ts` that runs the pipeline in mock mode and prints the weather strip, reminders, allocation and payout status; verify `npx tsx scripts/cash-weather-run.ts` exits 0 and prints 13 week labels.
- [x] 7.2a Add `src/app/api/p/cash-weather/sample-input/route.ts` returning the fixture run input; verify `PW/sample-input.test.ts` shows the body parses with the pipeline's input schema.
- [x] 7.3 Run the owner checks: `npx vitest run src/pipelines/cash-weather src/app/p/cash-weather` passes, the typecheck check prints nothing, `npx eslint src/pipelines/cash-weather src/app/p/cash-weather src/app/api/p/cash-weather` has no errors, and `openspec validate add-cash-weather-pipeline --strict` reports the change valid.
