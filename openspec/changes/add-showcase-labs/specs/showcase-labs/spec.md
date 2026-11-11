# Spec delta: showcase-labs

## Purpose

Read-only views that let a judge check the guard and the ledger themselves, plus the motion and stamp work that frames them.

## ADDED Requirements

### Requirement: The Guard Lab replays a recorded proposal through the real guard

The home page SHALL load the first outside `guard.verdict` from the featured Shop run's slip, or from the newest slip that has one. Spent MUST equal the sum of captures before that event's seq, and now MUST equal the stored verdict's `checkedAt`. The browser SHALL run the pure `guard(slip, proposal, { spent, now })` from `src/core/guard.ts` on an editable copy of the proposal's extracted facts: in-cart toggle, quantity, category, delivery date, power source and injection flag. The verdict, the per-clause states and a match-or-differ line against the stored ledger verdict SHALL update on every edit. The amount MUST be recomputed from the items.

#### Scenario: Unedited facts match the ledger

- **WHEN** the lab loads with the recorded red-team proposal and no edits
- **THEN** the verdict is outside with the same clause ids as the ledger
- **AND** the line reads that it matches the ledger verdict

#### Scenario: An edit changes the verdict

- **WHEN** the judge lowers a quantity so the recomputed amount fits the budget
- **THEN** the amount, verdict and clause states update at once
- **AND** the line reads that it differs from the ledger verdict and names the clauses that changed

#### Scenario: Injection flag keeps an item outside

- **WHEN** the judge sets the injection flag on an item whose price fits every budget clause
- **THEN** the verdict stays outside and the integrity clause shows as failed

### Requirement: The Guard Lab never writes and never exposes the principal

The Guard Lab loader MUST remove the principal's email before data reaches the client. The lab MUST NOT append events, call a server action, call a PayPal API or call a model. Edits SHALL live in component state only.

#### Scenario: Email is stripped

- **WHEN** the loader result is serialized for the client
- **THEN** the payload contains no email address

#### Scenario: Editing causes no write

- **WHEN** the judge edits any field and then reloads the page
- **THEN** no request other than the page load is sent
- **AND** the ledger event count is unchanged and the original facts show again

#### Scenario: No demo data

- **WHEN** no slip has an outside `guard.verdict`
- **THEN** the section shows an empty state telling the visitor to run the demo
- **AND** it shows no invented numbers

### Requirement: The Chain Lab recomputes the hero ledger in the browser

The browser SHALL recompute every link of the hero slip's ledger with Web Crypto as `sha256(prevHash + canonicalJson({seq, slipId, type, actor, at, data}))`, starting from GENESIS, using `canonicalJson` from `canonical-json.ts`, the file the server's `canonical.ts` re-exports. The lab MUST show the measured compute time.

#### Scenario: Untouched chain verifies

- **WHEN** the lab loads a seeded ledger
- **THEN** every recomputed hash equals the stored hash
- **AND** the lab shows the elapsed milliseconds

#### Scenario: Browser and server agree on bytes

- **WHEN** the same events are hashed by the server store and by `browser-hash.ts`
- **THEN** the hashes are identical for every seq

### Requirement: Tampering is shown broken and is never saved

The Chain Lab SHALL let a judge tamper with the events in memory through three presets (shrink the capture, flip the verdict to within, backdate one event) and a raw JSON edit of the selected tile. It MUST show the first broken seq and mark every later link as cascading from it. Tampered data MUST NOT be sent to any endpoint, written to storage or kept after reload.

#### Scenario: Changed amount breaks the chain

- **WHEN** the judge applies the "Shrink the capture" preset
- **THEN** the captured event's seq shows as the first broken link
- **AND** every later seq shows as a cascade
- **AND** nothing is written to the store or to browser storage

#### Scenario: Invalid raw JSON

- **WHEN** the judge types JSON that does not parse
- **THEN** the lab shows a parse error and keeps the last valid state
- **AND** no link changes

#### Scenario: Reload restores the ledger

- **WHEN** the judge tampers and reloads the page
- **THEN** the chain shows as intact

### Requirement: The Chain Lab falls back honestly without Web Crypto

When `crypto.subtle` is unavailable, the Chain Lab MUST show the server's `verifyChain` result and MUST say that the check was not run in the browser. Tamper controls SHALL be disabled in that state. With no ledger data, the lab SHALL show an empty state.

#### Scenario: Insecure context

- **WHEN** the lab runs where `globalThis.crypto.subtle` is undefined
- **THEN** it shows the server result with text that this is the server's check
- **AND** the tamper controls are disabled

#### Scenario: No demo data

- **WHEN** the hero slip has no events
- **THEN** the lab shows an empty state and no hashes

### Requirement: The hero replay shows the real verdicts without JavaScript

The clearance board SHALL replay the real demo verdicts with CSS animation and a replay control. The markup MUST render the end state by default so the content is visible without JavaScript. Under `prefers-reduced-motion: reduce` the replay MUST show the end state with no animation.

#### Scenario: JavaScript disabled

- **WHEN** the home page loads with JavaScript off
- **THEN** every verdict on the board is visible

#### Scenario: Reduced motion

- **WHEN** the visitor prefers reduced motion
- **THEN** the board shows the end state at once and the replay control does not animate

#### Scenario: Replay control

- **WHEN** the visitor presses replay
- **THEN** the sequence restarts from the first row and ends on the same verdicts

### Requirement: Plates morph into pipeline headers and routes transition

Each home pipeline plate named `plate-<id>` SHALL morph into that pipeline's header through React `<ViewTransition>`. The plate and the header MUST read one shared per-pipeline skin. A root route transition and a gliding active-nav pill SHALL be present. Under `prefers-reduced-motion: reduce`, all of these animations MUST be off and navigation MUST still work.

#### Scenario: Plate to header

- **WHEN** the visitor opens the Shop pipeline from its home plate
- **THEN** the header carries the name `plate-shop` and the plate morphs into it using the Shop skin

#### Scenario: Reduced motion

- **WHEN** the visitor prefers reduced motion and clicks a plate or a nav link
- **THEN** the page changes with no morph, no route animation and no pill glide

#### Scenario: Browser without view transitions

- **WHEN** the browser does not support view transitions
- **THEN** navigation completes normally with no error

### Requirement: The verdict stamp is the loudest element on screen

The verdict stamp SHALL press in like ink on paper and MUST be the most prominent element on every screen where it appears. It MUST carry the decision as a word. Under `prefers-reduced-motion: reduce` it SHALL render at rest with no animation.

#### Scenario: Outside stamp

- **WHEN** a verdict with decision outside renders
- **THEN** the stamp shows the word for outside and is the largest, highest-contrast element on the screen

#### Scenario: Reduced motion

- **WHEN** the visitor prefers reduced motion
- **THEN** the stamp is already at rest on first paint
