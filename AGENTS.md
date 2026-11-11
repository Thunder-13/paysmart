# AGENTS.md

PaySmart turns a plain-words shopping ask into carts a guard has checked, then pays only for the cart the user picks, through PayPal. This file is the working guide for any AI coding agent or new contributor. Public repo: https://github.com/Thunder-13/paysmart.

Two names, one codebase. PaySmart is the product and the front door (home page, header, the `paysmart` pipeline). Permission Slip is the engine inside it: the signed slip, the guard and the hash-chained ledger. Internal ids still say `permission-slip` on purpose (see "Do not").

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repo map

| Path | What lives there |
|---|---|
| `src/app` | App Router pages, `/p/<id>` pipeline pages, `/api` route handlers, `mock-paypal` approve page |
| `src/core` | Frozen `contracts.ts`, `guard.ts`, `extractor.ts`, `orchestrator.ts`, `services.ts`, `money.ts`, plus `rail/` (mock and sandbox PayPal), `ai/` (mock and anthropic), `store/` (SQLite, hashing), `affiliate/` |
| `src/server` | Runtime singleton (`runtime.ts`), `config.ts`, `http.ts`, `demo-seed.ts`, `cron.ts`, `webhook.ts` |
| `src/pipelines/<id>` | Seven pipelines: `paysmart`, `shop`, `second-look`, `bounty`, `cash-weather`, `toll-road`, `dispute-desk`. Registered in `src/pipelines/registry.ts` |
| `src/components` | Shared React components (slip card, ledger timeline, Guard Lab, Chain Lab) |
| `scripts/` | Seed, red-team and smoke scripts run with `tsx` |
| `openspec/` | Spec-driven changes under `openspec/changes/`, config in `openspec/config.yaml` |
| `docs/` | Conventions, stages, architecture brief |

## Commands

Node >= 22.13 is required (the store uses `node:sqlite`). Run everything from the repo root.

| Command | What it does |
|---|---|
| `npm run dev` | Start `next dev` on port 3000 |
| `npm run build` | `next build` |
| `npm run start` | `next start` on the built app |
| `npm run lint` | ESLint (Next core-web-vitals and TypeScript configs) |
| `npm run typecheck` | `next typegen`, then `tsc --noEmit` |
| `npm run test` | `vitest run` over `src/**/*.test.ts` and `scripts/**/*.test.ts` |
| `npm run test:watch` | Vitest in watch mode |
| `npm run spec:validate` | `openspec validate --all --strict` |
| `npm run demo:seed` | Seed all seven pipelines and verify every ledger chain |
| `npm run redteam` | Run the attack fixtures against the guard; every one must be blocked |
| `npm run smoke` | Run the per-pipeline smoke scripts in mock mode |

Per-path checks while you work:

- `npx vitest run <paths>` for the files you touched.
- `npm run -s typecheck 2>&1 | grep -E "<your paths>"` must print nothing.
- `openspec validate <change> --strict` for your OpenSpec change.

## Invariants

These must never break. A change that bends one needs the user's say-so first.

- The guard (`src/core/guard.ts`) is pure and deterministic. No I/O, no model calls.
- Untrusted text (listings, chats, web pages, dispute messages) goes only through the Extractor or a no-tool `ai.json` call. It never reaches the guard and never becomes instructions.
- Every AI call passes a deterministic `mock`. Mock mode runs every pipeline end to end with no keys.
- Money is a `Money` value (`{currency, value: "12.34"}`) handled with the `@/core/money` helpers. Never floats.
- Ledger events are append-only and hash-chained, one chain per slip. Never edit one.
- `src/core/contracts.ts` is the frozen contract. Change it only deliberately, and note why in your report.
- PayPal free text is clipped to 127 characters with `clipText` from `src/core/rail/clip.ts`.
- `/api/paypal/return` and `/api/paypal/cancel` resume only a run that is waiting on `paypal_approval`.

## Adding or changing a pipeline

1. Write the OpenSpec change first: `openspec/changes/add-<id>-pipeline/`. Run `openspec validate add-<id>-pipeline --strict`.
2. Build the pipeline in `src/pipelines/<id>/`. Import types from `@/core/contracts` and helpers from `@/core/*`. Steps get runtime services through `StepContext`; API routes use `getRuntime()` from `@/server/runtime`.
3. Put pages under `src/app/p/<id>/` and routes under `src/app/api/p/<id>/`.
4. Add the entry to `src/pipelines/registry.ts` (and the id to `PipelineId` in the contract, which counts as a deliberate contract change).
5. Write tests next to the code as `*.test.ts`, built with `createTestRuntime()` from `@/core/testing`.
6. Run the per-path checks above, then `npm run test` and `npm run lint`.

Need a dependency or an edit outside the paths you own? Ask before making it. `docs/CONVENTIONS.md` has the ownership table.

## Environment and modes

Mock is the default. Leave the keys empty and the whole app runs offline: a stateful mock PayPal rail plus scripted AI.

- `PAYPAL_MODE=sandbox` needs `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Without both, the app falls back to the mock rail.
- `AI_MODE=anthropic` needs `ANTHROPIC_API_KEY`. Models come from `ANTHROPIC_MODEL_SMART` and `ANTHROPIC_MODEL_FAST`.
- `CHANNEL3_API_KEY` turns on live product search; without it PaySmart uses the offline fixture catalog.
- `PAYPAL_WEBHOOK_ID`, `CRON_SECRET`, `AFFILIATE_ADMIN_SECRET` and the sandbox-only receiver emails are optional.

`.env.example` lists every variable with comments. Copy it to `.env.local`. Never commit `.env` files or `data/` (the SQLite database lives there).

## UI rules

- System fonts only. No `next/font` downloads.
- Paper-slip palette: paper `#FBF8F1`, ink `#1B2A41`, stamp green `#1F7A4D`, stamp red `#B3261E`, amber `#B7791F`.
- Accessible by default: labels on inputs, visible focus rings, `aria-live` for verdicts.
- No third-party logos or brand imagery. The word "PayPal" appears only where a PayPal action happens.
- New UI copy carries the PaySmart brand.

## Do not

- Rename internal ids without asking: package name `permission-slip`, `permission-slip.db`, the `render.yaml` service names, pipeline ids, ledger event names. Renaming the Render service changes the live URL.
- Run `next build` or `next dev` while other agents share the `.next` directory.
- Commit unless the user asks.
- Add `@paypal/agent-toolkit`. It was removed on purpose; the repo has its own PayPal REST client in `src/core/rail/sandbox.ts`.

## Further reading

- `docs/paysmart-architecture-brief.md` (architecture brief)
- `README.md`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/STAGES.md`
- `docs/CONVENTIONS.md`
