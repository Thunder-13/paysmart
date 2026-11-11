# Tasks

## 1. Foundations

- [x] 1.1 Implement `@/core/money` (integer cents, wire format, currency checks, formatMoney) and verify with `npx vitest run src/core/money.test.ts`
- [x] 1.2 Implement `@/core/ids` newId(prefix) with crypto randomness and verify ids match `^slip_[0-9a-z]{16}$` in `src/core/store/sqlite.test.ts`

## 2. Guard

- [x] 2.1 Implement all ten clause checks, payout receiver rules and the integrity check in `@/core/guard`, and verify pass, fail and unknown cases per clause with `npx vitest run src/core/guard.test.ts`
- [x] 2.2 Verify decision precedence (outside over ask over within) and determinism in the same test file

## 3. Store and ledger

- [x] 3.1 Implement `createSqliteStore` (slips, rail id index, blobs, docs) and verify CRUD, filters and findByRailId with `npx vitest run src/core/store`
- [x] 3.2 Implement the per-slip SHA-256 chain, verifyChain and subscribe, and verify tamper, rewrite and deletion detection in `src/core/store/sqlite.test.ts`
- [x] 3.3 Export typed event shapes and `appendVerdictEvent` from `@/core/events` and verify `npm run -s typecheck` is clean

## 4. PayPal rail

- [x] 4.1 Implement the mock rail state machine, seed data, upserting seeds, `calls()` and `asMockRail`, and verify with `npx vitest run src/core/rail/mock.test.ts`
- [x] 4.2 Implement the sandbox REST client (OAuth, request ids, all endpoints, multipart evidence, reporting windows) and verify request method, path, headers and body with `npx vitest run src/core/rail/sandbox.test.ts`

## 5. AI runtime

- [x] 5.1 Implement the mock AI (schema-checked json, script replay through real tools) and verify with `npx vitest run src/core/ai`
- [x] 5.2 Implement the Claude adapter (submit_result tool, repair retry, agent loop, images, refusal handling, fallbacks) and verify against a fake client in `src/core/ai/ai.test.ts`
- [x] 5.3 Implement the quarantined extractor and `detectInjection`, and verify attack and benign phrases with `npx vitest run src/core/extractor.test.ts`

## 6. Core services

- [x] 6.1 Implement compileSlip normalization, createSlip, beginSigning and completeSigning (AUTHORIZE and CAPTURE) and verify with `npx vitest run src/core/services.test.ts`
- [x] 6.2 Implement evaluate, settlePurchase, settlePayout, releaseRemainder and refund, and verify over-budget, injection, PayPal failure, double release and foreign capture cases in the same file
- [x] 6.3 Implement child slip carving with committed spend and parent capture of helper spend, and verify the helper scenario in the same file
- [x] 6.4 Implement addEvidence and evidencePack and verify chain ok, verdicts, evidence and summary in the same file

## 7. Orchestrator and runtime

- [x] 7.1 Implement the orchestrator (validation, waits, resume signal, per-run lock, 50-step cap, run events, buffered notes, begin/beginResume) and verify with `npx vitest run src/core/orchestrator.test.ts`
- [x] 7.2 Implement `buildRuntime`, `createTestRuntime`, `tamperEvent` and env-driven `getRuntime`, and verify with `npx vitest run src/core/testing.test.ts src/server`

## 8. HTTP API

- [x] 8.1 Add runs, slips, evidence, events (SSE), blobs and health routes under `src/app/api` and verify `npm run -s typecheck` (route types) is clean
- [x] 8.2 Add PayPal return, cancel and webhook routes with the redirect and webhook helpers, and verify with `npx vitest run src/server/server.test.ts`

## 9. UI kit and pages

- [x] 9.1 Add the UI kit components and `run-client` hooks under `src/components` and verify `npm run -s lint` shows no errors for `src/components`
- [x] 9.2 Replace the layout and home page, add the theme tokens to `globals.css`, and verify `npm run -s typecheck` is clean
- [x] 9.3 Add the `/mock-paypal/approve` simulator with server actions and verify typecheck and lint are clean for `src/app/mock-paypal`

## 10. Integration checks

- [x] 10.1 Run `npx vitest run src/core src/server` and confirm every test passes
- [x] 10.2 Run `openspec validate add-core-platform --strict` and confirm it passes
