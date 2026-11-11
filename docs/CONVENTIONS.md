# Conventions for the build swarm

## Ownership (strict: edit only what you own)

| Owner | Paths |
|---|---|
| orchestrator | `src/core/contracts.ts`, `src/pipelines/registry.ts`, `package.json`, `tsconfig.json`, `openspec/config.yaml`, `docs/CONVENTIONS.md`, `docs/STAGES.md` |
| core agent | `src/core/**` (except contracts.ts), `src/server/**`, `src/components/**`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/api/{runs,slips,events,blobs,paypal}/**`, `src/app/mock-paypal/**`, `openspec/changes/add-core-platform/**` |
| pipeline `<id>` agent | `src/pipelines/<id>/**`, `src/app/p/<id>/**`, `src/app/api/p/<id>/**`, `openspec/changes/add-<id>-pipeline/**`, `scripts/<id>-*.ts` |
| integration agent | `README.md`, `docs/**` (except the two orchestrator files), `scripts/demo-*.ts`, `scripts/redteam*.ts`, `render.yaml`, home page polish |

Need a dependency, a contract change, or an edit outside your paths? Do not make it.
Put it under "Requests" in your final report.

## Rules
- Pipelines import types from `@/core/contracts` and helpers from `@/core/*`. Runtime services come through `StepContext` in steps, or `getRuntime()` from `@/server/runtime` in API routes.
- Every AI call passes a deterministic `mock`. Mock mode must run every pipeline end to end with no keys.
- Untrusted text (listings, chats, web pages, dispute messages) goes through the Extractor or a no-tool `ai.json` call. It never reaches the guard and never becomes instructions.
- Money is `Money` ({currency, value "12.34"}). Use `@/core/money` helpers, never floats.
- Tests: vitest, files `*.test.ts` next to the code. Build tests with `createTestRuntime()` from `@/core/testing`.
- Checks a worker runs: `npx vitest run <your paths>`, and `npm run -s typecheck 2>&1 | grep -E "<your paths>"` must print nothing, and `openspec validate <your-change> --strict`.
- Do not run `next build` or `next dev` (shared `.next` dir). The integration stage does.
- Do not commit. Commits happen only when the user asks.
- UI: system fonts only (no next/font downloads). Paper-slip look: paper #FBF8F1, ink #1B2A41, stamp green #1F7A4D, stamp red #B3261E, amber #B7791F. Accessible: labels, focus rings, aria-live for verdicts.
- No third-party logos or brand imagery in the UI. The word "PayPal" appears only where a PayPal action happens.
