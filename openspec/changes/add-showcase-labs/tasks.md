# Tasks

Checks used below: `npx vitest run <files>`; `npm run typecheck` must exit 0; screenshots are the files under `/private/tmp/claude-501/ps-tools/shots/`. A box is ticked only after its check was re-run and passed, or its named screenshot was opened and shows what the task says.

## 1. Guard Lab

- [x] 1.1 `src/server/guard-lab.ts` exports `guardLab(rt, shopRunId)`. It loads an outside `guard.verdict` (featured Shop run first, then the newest slip with one), computes `spent` from earlier captures, uses the stored `checkedAt` as `now`, sets the principal's email to `null` and returns `null` with no data; verify `npx vitest run src/server/guard-lab.test.ts` passes (null on an empty runtime, stored verdict replays through the real guard with the same clause ids and `spent` 0.00, no email, injection violation drops when the flag is cleared). Re-run: 3 tests passed.
- [x] 1.2 `src/components/guard-lab.tsx` (`GuardLabClient`) runs the pure `guard(slip, proposal, { spent, now })` on editable facts, recomputes the amount from items and shows clause states and the match-or-differ line; verify `src/server/guard-lab.test.ts` (same run as 1.1, covers the guard call shape and the injection flag) and the screenshot `guard-lab-1440-flip.png`, which shows a changed quantity, the recomputed total, the clause board and "Same call as ledger #17". Component-level tests for the differ line and reset do not exist yet; see 1.4.
- [x] 1.3 `src/app/_home/guard-lab-section.tsx` mounts the lab on the home page; verify `npm run typecheck` exits 0 and the screenshots `guard-lab-1440.png` and `guard-lab-390.png` show the lab.
- [ ] 1.4 Add a component test for `GuardLabClient`: unedited facts show the match line, a changed quantity shows the differ line naming the changed clause ids, an injection flag keeps the verdict outside with a price that fits, reset restores. No such test file exists today.

## 2. Chain Lab

- [x] 2.1 `src/core/store/canonical-json.ts` is the single canonical JSON function and `src/core/store/canonical.ts` re-exports it, so the server store is unchanged; verify `npx vitest run src/core/store` passes (the existing `canonicalJson` and chain tests in `sqlite.test.ts` pass unchanged, and `browser-hash.test.ts` recomputes every stored server hash exactly). Re-run: 4 files, 19 tests passed together with the other two named test files.
- [x] 2.2 `src/core/store/browser-hash.ts` recomputes links with Web Crypto (`ledgerHashWeb`, `verifyChainWeb`); verify `npx vitest run src/core/store/browser-hash.test.ts` passes (hashes equal the server's for a seeded ledger, survive a JSON round trip, an edited event breaks at its seq and every later seq fails, a broken `prevHash` is `link-broken`). The elapsed time is measured by the component, not by this module.
- [x] 2.3 `src/server/chain-lab.ts` exports `chainLab(rt, shopRunId)`; verify `npx vitest run src/server/chain-lab.test.ts` passes (null on an empty ledger, the hero slip's chain comes back and the browser verifies it after a JSON round trip).
- [x] 2.4 `src/components/chain-lab.tsx` shows links as tiles, the elapsed time, the three presets and the raw JSON edit of the selected tile; verify the screenshots `chainlab-1440.png`, `chainlab-390.png`, `chainlab-tamper-1440.png` and `chainlab-tamper-390.png`. The tamper capture shows "Broken at #25. The 9 links after it fail too.", seq 25 marked edited and every later tile red.
- [ ] 2.5 Add a component test for `ChainLab`: tamper never calls fetch or the store, invalid JSON shows an error and keeps the last good state, missing `crypto.subtle` shows the server result and disables tamper, an empty ledger shows the empty state. No such test file exists today.

## 3. Hero replay

- [x] 3.1 `HeroReplay` (`src/components/hero-replay.tsx`) and `src/app/styles/replay.css` add the CSS replay, the Replay control and the reduced-motion end state; verify `npx eslint src/app` exits 0 (re-run: exit 0) and the screenshot `replay-reduced.png` (opened: every verdict, the slip and the Replay control visible at once) next to `replay-1280.png` and `replay-390-end.png`.
- [x] 3.2 Capture the home page with JavaScript disabled and confirm every verdict shows. Evidence: /private/tmp/claude-501/ps-tools/shots/nojs-home-1440.png (slip, c1 to c3 lit, #20 within, #17 outside with integrity, chain caption) and nojs-ledger-1440.png; the home sections now render inline without Suspense so the first HTML carries them.

## 4. Plate morph and route transitions

- [x] 4.1 `src/components/plate-skins.ts` holds one skin per pipeline and a `ViewTransition` named `plate-<id>` wraps the home plates (`src/app/_home/pipelines.tsx`) and `PipelineHeader`; verify `npm run typecheck` exits 0 and the screenshots `plates-home.png` plus `plates-<id>-d.png` and `plates-<id>-m.png` for shop, second-look, bounty, cash-weather, toll-road and dispute-desk exist. No `src/app/_home` unit test exists.
- [x] 4.2 Route transition (`src/components/motion/route-transition.tsx`) and the gliding `nav-active` pill (`src/components/nav-links.tsx`, `src/app/styles/motion.css`) with one reduced-motion block. Evidence: slowed plate-click frames /private/tmp/claude-501/ps-tools/shots/morph-0.png, morph-700.png, morph-2500.png, morph-5000.png; vt-reduce.mjs read document.getAnimations() during a plate click: no-preference runs plate-shop group 520ms and route-fade 140ms, reduce leaves only zero-duration root pseudos.

## 5. Verdict stamp

- [x] 5.1 `src/components/verdict-stamp.tsx` and `src/app/styles/stamp.css` rebuild the stamp as an ink press, laid out by container query, resting at -3deg; verify the screenshots `stamp-reduced.png` (opened: the OUTSIDE SLIP word on a red holder, the clauses beneath, at rest) and `guard-lab-1440-flip.png` (the stamp is the largest element in the verdict column). No stamp unit test exists.

## 6. Whole change

- [x] 6.1 Verify `npm run typecheck` exits 0, `npx vitest run` passes in full (re-run: 97 files, 680 tests passed) and `npx openspec validate --all --strict` passes.
