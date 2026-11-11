# Design: showcase labs

## Step graph

These are read-only views. They have no steps, no waits and no resume signals, so there is no pipeline step graph. The data flow replaces it.

```
ledger (sqlite events, written by pipelines)
  -> server loader   (guardLab() in src/server/guard-lab.ts, chainLab() in src/server/chain-lab.ts; read only, strips email)
  -> client component (GuardLabClient in src/components/guard-lab.tsx, ChainLab in chain-lab.tsx; holds edits in React state)
  -> pure function   (guard() from src/core/guard.ts; verifyChainWeb() in src/core/store/browser-hash.ts, SHA-256 via crypto.subtle)
  -> screen          (verdict, clause states, match-or-differ, first broken seq)
```

Nothing flows back. No server action, route handler or fetch from a lab writes.

## CoreServices and PayPalRail calls

None. The loaders read events through the existing store read functions only. No `PayPalRail` method and no `ai.*` service is called.

## Guard Lab

Loader `guardLab(rt, shopRunId)` in `src/server/guard-lab.ts`:

1. Pick the slip: the featured Shop run's slip if it has an outside `guard.verdict`, else the newest slip with one. None found returns `null`, and the home section renders its empty state.
2. On that slip take an outside `guard.verdict` event, preferring one that carries the integrity clause, else the first. `spent` is the sum of `rail.captured` amounts on events with a lower seq. `now` is that verdict's stored `checkedAt`.
3. Return `{ slip, proposal, stored, seq, hash, spent, now }` where `stored` is the ledger verdict (decision and clause ids). The slip's principal email is set to `null` here, so it never enters the client payload.

Client `GuardLab` keeps an editable copy of the proposal's extracted facts: in-cart toggle, quantity, category, delivery date, power source and injection flag per item. On every edit it recomputes the amount from the items (unit price times quantity), calls `guard(slip, proposal, { spent, now })` and renders the decision, each clause as pass, fail or unknown, and one line: "Matches the ledger verdict" or "Differs from the ledger verdict" naming the clause ids that changed. A reset button restores the stored facts.

The injection flag is a fact like the others: when it is set, the item stays outside whatever the price is.

## Chain Lab

- `canonical-json.ts` exports `canonicalJson(value)`, `GENESIS` and `normalizeJson`: sorted keys, no whitespace, the same bytes the server wrote. `canonical.ts` re-exports them, so the server store keeps its imports and its bytes are unchanged. The browser imports `canonical-json.ts`, which has no node imports.
- `browser-hash.ts` exports `ledgerHashWeb(prevHash, event)`, `verifyChainWeb(events)`, `sha256HexWeb` and `webCryptoAvailable()`. It computes `sha256(prevHash + canonicalJson({seq, slipId, type, actor, at, data}))` with `crypto.subtle.digest`, starting from GENESIS, and returns per-link results with a status of `ok`, `hash-mismatch` or `link-broken`. Each event is hashed against the previous event's stored hash.
- `chainLab(rt, shopRunId)` in `src/server/chain-lab.ts` returns the hero slip's events (at most 80) with their stored hashes, or `null` with no ledger. The home ledger section adds the server's `verifyChain` result.
- `ChainLab` shows every link as a tile (seq, type, short hash, ok, broken or cascade), times the check with `performance.now()` and shows the elapsed milliseconds, and offers a tamper panel. Presets: "Shrink the capture", "Flip the verdict to within" and "Backdate one event". A raw JSON editor edits the selected tile's event. The edited copy lives in React state. The first seq whose recomputed hash differs from the stored one is marked broken, and every later link is marked as cascading from it.
- When `globalThis.crypto?.subtle` is undefined, the lab skips recomputation, shows the server `verifyChain` result and the text "This browser context has no Web Crypto, so this is the server's check, not yours." Tamper controls are disabled in that state.

## Hero replay

The clearance board verdicts come from the real demo data. Choreography is CSS only: each row has an animation delay in a CSS variable and the stamp lands in sequence. The default markup is the end state, so content shows without JavaScript. A small client control adds a class that restarts the animation. Under `prefers-reduced-motion: reduce` the animation is removed and the end state shows.

## Plate morph and route transitions

- Each home plate sets `viewTransitionName` `plate-<id>` through React `<ViewTransition name=...>`. The pipeline page header uses the same name, so the plate morphs into the header.
- A per-pipeline skin (accent color, paper tint, glyph) lives in one map keyed by pipeline id. The plate and the header both read it.
- A root `<ViewTransition>` in the layout handles route changes. The nav pill is one element whose position follows the active link, so it glides between links.
- A single `@media (prefers-reduced-motion: reduce)` block sets `::view-transition-*` animation to none and disables the pill glide.

## Verdict stamp

The stamp animates scale, rotation and a short ink bleed on mount, then rests. It has the largest size, weight and contrast of anything on a screen where it appears. Under reduced motion it renders at rest with no animation. The stamp text carries the decision as words, so color is never the only signal.

## Failure and abuse paths

- Tampered event in the Chain Lab: shown broken, held in component state only, gone on reload, never sent to any endpoint.
- Injection-flagged item: stays outside in the Guard Lab even when the price fits.
- No `crypto.subtle`: honest fallback to the server result.
- No demo data: both labs render an empty state that says to run the demo, with no fake numbers.
- Email in the client payload: the loader strips it, and a test asserts the serialized payload has no `@`.
