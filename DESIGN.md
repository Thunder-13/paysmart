# Design: PaySmart

The locked system. Every page shares it; change it on purpose, the file is the rule. Tokens live in `src/app/globals.css` (`@theme static`), under the project's own names.

## System
- Genre: modern-minimal. Home `/` is a page (hero: the PaySmart ask box); every `/p/*`, `/affiliates` and `/mock-paypal/*` screen is an app screen.
- Theme: brand, PayPal60 (spec in `.hallmark/brand-spec.md`), pushed further. Direction: the clearance board. Every money move is a strip the guard racks into a bay: Within slip, Needs your call, Outside slip.
- Home order: PaySmart hero (the ask box, example chips and a four-step summary on the night field, the first thing at 1440x900 and 390 wide), the proof section "Watch the guard stop a hijacked cart" (the replay on the clearance board), Guard Lab, "Inside PaySmart" (the six pipelines), nine ideas, Chain Lab (`#ledger`), then the footer mast. Each section is a file in `src/app/_home/`; `src/app/page.tsx` only orders them.
- CSS layers: each area owns one file under `src/app/styles/` (`motion`, `replay`, `guard-lab`, `chain-lab`, `plates`, `stamp`), imported by `globals.css`. A layer file starts with its stamp line, `/* Hallmark · layer: <name> (stamp, critique and waivers in globals.css) */`. New non-colour tokens (durations, distances, sizes) go in a `:root` block at the top of the layer, under the layer's prefix (`--replay-*`, `--chain-*`, `--lab-*`, `--plate-*`, `--motion-*`, `--stamp-*`). Colour tokens stay in `@theme static`.
- Axes: light/grotesk-sans/chromatic-blue · posture: full palette.
- Never: the PayPal logo, PayPal's licensed faces, gradients, glows, drop shadows, eyebrows, tracked-caps labels, middle-dot meta strings, emoji icons.

## Colour roles (Tailwind utilities)
| Role | Utility | Use |
| --- | --- | --- |
| Ground | `bg-paper` | page background (cool grey, PayPal neutral-100) |
| Well | `bg-paper-deep` | inset areas, chips, perforations; never a border inside it |
| Surface | `bg-card` | cards; `border border-line`, no shadow |
| Ink | `text-ink`, `text-ink-soft`, `text-ink-faint` | body, secondary, meta (all pass 4.5:1 on paper and card) |
| Hairline | `border-line` | dividers, card edges |
| Field edge | `border-edge` | inputs, selects, textareas, checkboxes (3:1) |
| Night field | `bg-night` + `text-on-night` / `text-on-night-soft`, raised `bg-night-2`, `bg-night-3`, rules `border-night-line` | nav, home hero, ledger plate. Add class `on-night` so focus rings turn sky |
| PayPal blue | `bg-pp-blue` + `text-on-plate`, deeper `bg-pp-blue-deep` | links (`text-pp-blue`), focus, active, the Shop tile on home, API chips on the header plate |
| PayPal deep blue | `bg-pp-deep` + `text-on-plate` | the pipeline header plate (kept off the accent so app screens stay restrained) |
| Sky | `bg-pp-sky` + `text-night`, wash `bg-pp-sky-wash` | WITHIN: cleared strips, active/ok states on night |
| Gold | `bg-pp-gold` + `text-night`, wash `bg-pp-gold-wash`, text `text-stamp-amber` | ASK: needs your call, waiting, held, signatures, Cash Weather storm weeks |
| Red | `bg-stamp-red` + `text-on-plate`, wash `bg-red-wash`, text `text-stamp-red` | OUTSIDE and real failures only. Red belongs to refusal alone |
| Green | `text-stamp-green`, `bg-green-wash`, `bg-stamp-green` | success that is not a guard verdict: chain verified, paid, met |

Text on a coloured surface takes that surface's ink (`text-on-plate`, `text-night`), never grey. No alpha colours (`/40`, `/60`) except on overlays.

## Type
- One family, Albert Sans (`font-sans`, `font-display`; `font-serif` now maps to it too). Azeret Mono (`font-mono`) only for code: ids, hashes, clause ids (`c1`), API names, URLs, HTTP. Money is never mono: `font-semibold tabular-nums`.
- Weights: 400 body, 600 labels and controls, 800 (`font-extrabold`) display. Avoid 500/700/900 except the verdict stamp word (`font-black`).
- Scale (app): `text-xs` 13px meta, `text-sm` 14px labels, `text-base` 16px body, `text-lg` 19px lead, `text-xl` 23px card titles, `text-2xl` 28px section heads, `text-3xl`/`4xl`/`5xl` screen titles. Heads `tracking-tight`. Nothing under 12px; never `text-[0.7rem]`-style sizes.
- Labels, captions, table heads, chips, tags: sentence case, untracked, the body face a step smaller. Never `uppercase`, never `tracking-wider`/`tracking-[...]` on text 15px or under.

## Shape and depth
- Radii: `rounded-xs` 6px (clause chips), `rounded-sm` 8px, `rounded-md` 12px (inputs, inner rows), `rounded-lg`/`rounded-card` 16px (cards), `rounded-xl` 24px, `rounded-2xl` 32px (plates), `rounded-plate` 40px (screen plates), `rounded-pill` (buttons, chips, badges). Inner radius = outer minus padding.
- Depth comes from overlapping flat plates. All `shadow-*` utilities resolve to nothing; do not add box-shadow or `ring` as decoration. Never a card inside a card: inside a card use a well (`bg-paper-deep`, no border) or hairlines.

## Controls (app range, 40px; 44px hit target)
- Primary, one per view: `inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55`. On night/blue plates invert: `bg-on-night text-night hover:bg-pp-sky`.
- Secondary: `h-11 rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink hover:border-ink active:bg-paper-deep`.
- Text action: `font-semibold text-pp-blue underline decoration-line underline-offset-4 hover:decoration-pp-blue`.
- Destructive: secondary shape, `text-stamp-red border-stamp-red`.
- Inputs/textarea/select: `field` class (border-edge, card bg, rounded-md, inset focus outline) plus `px-4 py-2.5 text-base`; same height as the button beside them. Checkbox/radio: `accent-pp-blue h-4 w-4`.
- Every interactive element: visible `:focus-visible` (global ring is set; never `outline-none` without a replacement), a hover, an `active:` and a `disabled:` state. Transitions name properties: `transition-colors` or `transition-transform` / `transition-opacity`, `duration-[120ms]`. Never `transition` alone or `transition-all`; never animate width/height/top/left (use `scale-x` with `origin-left` for progress bars).

## Signature pieces (already built, reuse them)
- `ClearanceBoard` (`src/components/clearance-board.tsx`, strips from `board-strips.ts`) racks real `guard.verdict` events into Within slip, Needs your call, Outside slip. `variant="hero"` pins the slip over the board (home); `variant="band"` lays out by container query: the three bays sit side by side only when the board is wide (`@4xl:`), and stack in narrow columns such as the Dispute Desk sidebar and bounty cards. An empty bay reads "None on this slip". With no verdicts at all, the hero board shows strip-shaped sockets keyed sky, gold and red under an idle scan bar, and in mock mode its caption says what loading the demo does.
- `SlipBoard` (`src/components/slip-board.tsx`) is the band for one slip, live from its ledger. Every run screen carries it beside its `LedgerTimeline`, and it renders nothing until the guard has made a call. It reads `useSlipEvents`, which keeps one shared, ref-counted EventSource per slip (`src/components/run-client.ts`), so adding a reader never opens a second stream.
- `HeroReplay` (`src/components/hero-replay.tsx`) wraps the board and its caption. The Replay control bumps a key that remounts them, so the CSS sequence of the real demo verdicts plays again in about 4.6s. Its keyframes are in `src/app/styles/replay.css`.
- `GuardLab` (`src/components/guard-lab.tsx`, loader `src/server/guard-lab.ts`, section `src/app/_home/guard-lab-section.tsx`) runs the real `guard()` in the browser on the facts of a recorded outside verdict. The viewer edits quantity and other facts, clauses flip, and one line says whether the call matches the ledger.
- `ChainLab` (`src/components/chain-lab.tsx`, `src/core/store/browser-hash.ts`, `canonical-json.ts`, loader `src/server/chain-lab.ts`) re-hashes the hero ledger with Web Crypto. Ledger records are tiles. A preset or a raw JSON edit of the selected tile tampers in memory, and the broken tile and every later tile cascade to red.
- `PLATE_SKINS` (`src/components/plate-skins.ts`) holds one skin per pipeline id. The home plate (`src/app/_home/pipelines.tsx`) and `PipelineHeader` both read it and wrap themselves in a `ViewTransition` named `plate-<id>`, so the plate morphs into the header.
- The nav pill is the `nav-pill-active` link in `src/components/nav-links.tsx`, named `nav-active` so it glides between links. The footer mast (`src/components/app-shell.tsx`) is the night field with the pipeline links and the wordmark at display scale.
- `VerdictStamp` is a clearance strip: coloured holder with the stamp word, an ink press that lands crooked at -3deg and rests there, then the clauses that decided it as chips (`c2` in `bg-stamp-red text-on-plate font-mono`). It lays out by container query (`@container`, `@3xl:`), not by viewport.
- `SlipCard` is the slip torn from a pad: perforated top, clause chips, a five-figure `dl`, a seal that presses onto the signature line (`stamp-seal`).
- `PipelineHeader` takes its pipeline's plate skin from `PLATE_SKINS`, so it matches the home plate it morphs from, with the title and line on the left and "PayPal and AI it uses" as chips in the skin's chip colour.
- `LedgerTimeline` is the strip log: actor icon, line, detail, then `#seq type time hash` as spaced mono spans, with a link glyph on the rail joining each row to the one above.
- `WaitPanel` shows waiting as a gold bar that breathes on `scaleX` (`stamp-wait-bar`).
- Stepper buttons (quantity minus and plus) are pills: `h-11 w-11 rounded-pill border border-edge bg-card`.
- Action labels built from data (the Guard Lab moves) are one line: `max-w-full truncate whitespace-nowrap`, with the full label in `title`.
- Status chips: `rounded-pill border px-2.5 py-0.5 text-xs font-semibold`, coloured by role above.
- Keyboard and live regions: a control that unmounts on use hands focus to the next one (Guard Lab moves); bounds use `aria-disabled`, never `disabled`, so focus stays put; a grid of records is one tab stop with arrow keys (Chain Lab tiles); a verdict announces once, politely (`VerdictStamp` is `role="status"`); a horizontally scrolling table wrapper is a focusable, labelled region.
- Rendering: the home sections render inline, without Suspense, so the first HTML carries real verdicts and the page is complete with scripting off. Below lg only the compact top bar (wordmark and mode chips) is sticky; the pipeline nav scrolls away.
- Link previews: `src/app/opengraph-image.tsx` draws the night field, the headline in Albert Sans (OFL, vendored in `src/app/_og/`) and the demo slip's real c1 to c3 stamped OUTSIDE SLIP. It is the one file allowed literal hex, because Satori cannot read the oklch tokens. Page titles follow "<Pipeline> | PaySmart"; the OG image carries the PaySmart wordmark and the line "Say what you need. PayPal pays only for the cart you pick." beside the demo slip.

## Copy rules
- Meta strings: separate spans with `gap-x-3`, never joined by ` · `. Arrows never glued to link text. No status dots before labels.
- No em or en dashes in new copy (one exception: the Cash Weather week ranges, which a test asserts). Real ellipsis `…`.
- Never invent a figure, quote or claim. Keep every existing word unless it breaks a rule above.

## Motion
- Character: brisk. Motion names its authored moments; everything else is still.
- The proof section's replay is the home's one long sequence (about 4.6s): slip settles, rows compile, strips rack in, a scan crosses each strip, clause chips light, the stamp lands.
- The viewer triggers the rest: the Chain Lab verification reveal and the tamper cascade (`--i` steps each failing tile), and the Guard Lab clause flips (`lab-flip`). The stamp press and the seal press play when a verdict or signed slip mounts. Rows may `animate-fade-in`.
- Route transitions and the plate morph run under every navigation: `RouteTransition` (`src/components/motion/route-transition.tsx`) wraps the page body in a keyed `ViewTransition` with `route-out` and `route-in`; the header and the nav pill hold their own names (`site-header`, `nav-active`).
- Rules the code follows:
  - CSS keyframes with `fill-mode: both`, so content is visible without JS.
  - Scroll-driven animation (`animation-timeline`) only inside `@supports` and `prefers-reduced-motion: no-preference`, animating `transform`, `translate` or `scale` and never opacity, so full-page captures show every element.
  - JS writes only custom properties, classes and data attributes (`--i`, `data-state`, `data-cascade`, `html[data-scrolled]` from `ScrollSentinel`). It never writes inline animation values.
  - Every `::view-transition-*` pseudo is switched off under `prefers-reduced-motion: reduce`, and the global rule ends every other animation at once.

## Exports
Tokens in `src/app/globals.css`. Tailwind 4 utilities only; no other format requested.
