# Proposal: showcase labs that let a judge test the guard and the ledger

## Why

The guard and the hash-chained ledger are the core of Permission Slip, but a judge reading the home page has to take our word for both. Two small labs let them check the claims with their own hands. The Guard Lab runs the real guard on a real recorded proposal and lets the judge change the facts. The Chain Lab recomputes every hash link of the hero slip in the browser and lets the judge break one. A replay of the clearance board and a sharper stamp make the first screen show the product working. Route transitions tie the six pipelines together visually.

## What changes

- **Guard Lab.** The home page loads the first outside `guard.verdict` event from the featured Shop run's slip, or from the newest slip that has one. Spent is the sum of captures before that event's seq. Now is that verdict's `checkedAt`. The browser runs the pure `guard(slip, proposal, { spent, now })` from `src/core/guard.ts` on an editable copy of the proposal's extracted facts: in-cart toggle, quantity, category, delivery date, power source and injection flag. The verdict, the per-clause states and a match-or-differ line against the stored ledger verdict update on every edit. The amount is recomputed from the items. The principal's email is removed on the server before data reaches the client. The lab writes nothing.
- **Chain Lab.** `src/core/store/canonical-json.ts` holds the one canonical JSON function used by the server and the browser, and `canonical.ts` re-exports it. `src/core/store/browser-hash.ts` recomputes every link of the hero slip's ledger with Web Crypto using `sha256(prevHash + canonicalJson({seq, slipId, type, actor, at, data}))`, starting from GENESIS. The lab shows the measured compute time and lets a judge tamper in memory with three presets (shrink the capture, flip the verdict to within, backdate one event) or a raw JSON edit of the selected tile. It shows the first broken seq and the cascade after it. Nothing persists. Where `crypto.subtle` is missing (an insecure context), the lab shows the server's `verifyChain` result and says so.
- **Hero replay.** A CSS-choreographed replay of the real demo verdicts on the clearance board, with a replay control, an end state under reduced motion, and the full content visible without JavaScript.
- **Plate morph and route transitions.** React `<ViewTransition>` morphs each home pipeline plate (`plate-<id>`) into that pipeline's header. A per-pipeline skin is shared by the plate and the header. A root route transition and a gliding active-nav pill complete the set. All of it is off under `prefers-reduced-motion`.
- **Verdict stamp upgrade.** The stamp presses in like ink on paper and is the loudest element on any screen where it appears.

## Capabilities

### New capabilities

- `showcase-labs`: read-only home page labs, the hero replay, view transitions and the stamp.

### Modified capabilities

None in `openspec/specs/`. The labs read what `add-core-platform` and `add-shop-pipeline` already write.

## PayPal APIs exercised

None called by this change. The labs and the replay only read ledger events that other changes produce through PayPal Orders v2 (create, authorize), Payments v2 (capture, void, refund) and, for other pipelines, Payouts v1. No new rail method, no new webhook, no new env var.

## AI capabilities exercised

None. No model is called. The proposal facts the Guard Lab edits were extracted earlier by the quarantined extractor in the Shop run. The labs only replay the deterministic `guard()` on those facts.

## Impact

- New: `src/server/guard-lab.ts`, `src/components/guard-lab.tsx`, `src/app/_home/guard-lab-section.tsx`, `src/core/store/canonical-json.ts`, `src/core/store/browser-hash.ts`, `src/server/chain-lab.ts`, `src/components/chain-lab.tsx`, and the tests `src/server/guard-lab.test.ts`, `src/core/store/browser-hash.test.ts` and `src/server/chain-lab.test.ts`.
- Changed: the home page, the pipeline header and plate components, the app layout and nav, the verdict stamp component and global CSS.
- `src/core/store/canonical.ts` re-exports `canonicalJson` from the new file, so the server's imports and output bytes are unchanged and existing hashes still verify.
- No contract change, no new dependencies.

## Non-goals

- Any write path. The labs never append events, save a tampered chain or change a slip.
- Any PayPal call or model call from a lab.
- Editing the guard's rules, clause ids or thresholds. The labs run the guard as it is.
- Hash verification of every slip. Only the hero slip's ledger is recomputed.
- Server-side tamper simulation or a shareable link to a tampered state.
- Animation that carries information the static page lacks.
