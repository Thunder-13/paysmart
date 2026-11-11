# Tasks

Checks used below: `npx vitest run <file>`; "paysmart typecheck clean" means `npm run -s typecheck 2>&1 | grep -E "src/pipelines/paysmart|scripts/paysmart"` prints nothing. Tests use `createTestRuntime()` and the fixed clock `2026-11-08T18:00:00Z` (a Sunday) unless a task says otherwise.

## 1. Fixtures, router, compile

- [x] 1.1 `src/pipelines/paysmart/fixtures.ts`: three PaySmart listings, keyword search with a price cap, facts for each; verify `npx vitest run src/pipelines/paysmart/fixtures.test.ts`.
- [x] 1.2 `src/pipelines/paysmart/router.ts`: `mockRoute`, router prompt, detector override, handoff builder; verify `npx vitest run src/pipelines/paysmart/router.test.ts` (six example asks route correctly, the demo ask yields two needs, a scam phrase overrides `buy`).
- [x] 1.3 `src/pipelines/paysmart/compile.ts`: PaySmart guidance, `mockCompile`, request screens; verify `npx vitest run src/pipelines/paysmart/compile.test.ts` (no budget, over cap, gift card not asked for).

## 2. Screens and session

- [x] 2.1 `src/pipelines/paysmart/screens.ts`: integrity, seller and slip screens, product status, funnel; verify `npx vitest run src/pipelines/paysmart/screens.test.ts` (seller quote, integrity on Shop's planted bundle).
- [x] 2.2 `src/pipelines/paysmart/discover.ts` and `board.ts`: one search per need, screens, quarantined inspection, slip stamps, `SearchRun` and `paysmart.search` events; verify `npx vitest run src/pipelines/paysmart/steps.test.ts -t discover` (one search saved after the first step, correct counts, Channel3 fallback).
- [x] 2.3 `src/pipelines/paysmart/session.ts` and `agent.ts`: the two assemble tools and the demo mock script; verify `npx vitest run src/pipelines/paysmart/session.test.ts` (no search tool, battery cart OUTSIDE on the exclusion clause, scam seller tool error, ruled-out text never in a tool result or the task).

- [x] 2.4 `genericAssembleScript` in `src/pipelines/paysmart/agent.ts`, used by `assemble` when the demo listings are not on the board; verify `npx vitest run src/pipelines/paysmart/generic.test.ts` (single-need ask paid end to end, stubbed Channel3 options, missing need rationale, demo path unchanged).

## 3. Steps

- [x] 3.1 `src/pipelines/paysmart/steps.ts`, `meta.ts`, `index.ts`: the step graph with `discover` and `assemble`; verify `npx vitest run src/pipelines/paysmart/steps.test.ts` (every handoff, voice `askVia` in the ledger, clarify rounds, request screen fails, decline makes zero rail calls, clause edit re-stamp, bad signals re-wait).
- [x] 3.2 Payment steps: verify `npx vitest run src/pipelines/paysmart/steps.pay.test.ts` (option 1 and 2 totals, capture failure voids, PayPal decline, guard block at capture, delivery breach refunds, skip).

## 4. End to end

- [x] 4.1 `src/pipelines/paysmart/paysmart.e2e.test.ts`: demo run, funnel counts, red team, Dispute Desk lookup by capture id; verify `npx vitest run src/pipelines/paysmart/paysmart.e2e.test.ts`.
- [x] 4.2 `scripts/paysmart-smoke.ts`: demo and red-team runs; verify `npx tsx scripts/paysmart-smoke.ts` exits 0.

## 5. Gates

- [x] 5.1 Verify `npx vitest run src/pipelines/paysmart` passes in full and paysmart typecheck is clean.
- [x] 5.2 Verify `npx eslint src/pipelines/paysmart scripts/paysmart-smoke.ts` exits 0.
- [x] 5.3 Verify `npx vitest run src/pipelines/shop src/pipelines/second-look` still passes.
- [x] 5.4 Verify `npx openspec validate add-paysmart-pipeline --strict` passes.
