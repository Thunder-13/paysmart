# Tasks

Checks used below: `npx vitest run <file>`; "shop typecheck clean" means `npm run -s typecheck 2>&1 | grep -E "src/(pipelines|app/p|app/api/p)/shop"` prints nothing. Tests use `createTestRuntime()` and the fixed clock `2026-11-08T18:00:00Z` unless a task says otherwise.

## 1. Types and session

- [x] 1.1 Add `MAX_OPTIONS`, `ShopOption`, `RuledOut`, the three new `ShopState` fields and `optionId` on `ConfirmCartSignalSchema` in `src/pipelines/shop/types.ts`; initialise them in `initialShopState`; verify shop typecheck clean.
- [x] 1.2 Change `propose_cart` in `src/pipelines/shop/tools.ts` to build `options` and `ruledOut` (duplicate cart refused without spending a proposal, sort WITHIN before ASK, `session.cart` = default option); verify `npx vitest run src/pipelines/shop/tools.test.ts` passes with new cases: two WITHIN proposals give 2 options; an OUTSIDE proposal lands in `ruledOut` with its clause ids; a duplicate leaves `proposals` unchanged; an ASK option sorts after a WITHIN one.

## 2. Agent

- [x] 2.1 Update `AGENT_SYSTEM` and both mock script paths in `src/pipelines/shop/agent.ts` (dig kit as option 2); verify `npx vitest run src/pipelines/shop/redteam.test.ts` passes (proposal 1 OUTSIDE c1, c2, integrity at $419.96; proposal 2 Clockwork Rex $42.18 within; proposal 3 dig kit $21.40 within; 3 proposals total).

## 3. Steps

- [x] 3.1 `shop` step stores `options`, `ruledOut`, default selection; cart wait payload adds `options` (with per-option totals), `ruledOut`, `selectedOptionId`; verify `npx vitest run src/pipelines/shop/steps.shop.test.ts` passes (clean run: 2 options, default Rex; red team: `ruledOut` has the hijack; 3 OUTSIDE proposals still end `no_cart` with the hold voided).
- [x] 3.2 `confirm_cart` handles `optionId` (unknown id re-waits, re-evaluate on switch, OUTSIDE after switch re-waits, attestations on the chosen option, `shop.option_chosen` with actor `user`); verify `npx vitest run src/pipelines/shop/steps.settle.test.ts` passes new cases: option 2 captures $21.40 and releases $38.60; `opt-99` re-waits with no capture; no `optionId` captures $42.18.

## 4. Voice

- [x] 4.1 Add `choose_option` to `parseVoiceCommand` in `src/pipelines/shop/voice.ts`; verify `npx vitest run src/pipelines/shop/voice.test.ts` passes ("option two", "pick option 2", "choose the second option" give index 2; "option 4" and "don't pick option 2" give null; existing cart verbs unchanged).

## 5. UI

- [x] 5.1 Add `OptionsPanel` to `src/app/p/shop/panels.tsx` and render it from `shop-console.tsx` at `confirm_cart`; selection drives totals, attestation fields and the Approve label, and the approve signal sends `optionId`; wire voice `choose_option` in `voice-controls.tsx`; verify shop typecheck clean and `npx eslint src/app/p/shop` exits 0.

## 6. End to end

- [x] 6.1 Update `scripts/shop-smoke.ts` to print the options and pick option 1 by id; verify `npx tsx scripts/shop-smoke.ts --red-team` exits 0 and prints 2 options and 1 ruled-out cart.
- [x] 6.2 Verify `npx vitest run src/pipelines/shop` passes in full and `openspec validate add-shop-choices --strict` passes.
