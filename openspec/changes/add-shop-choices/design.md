# Design: shop choices

## Step graph (changes marked)

```
intake -> compile -> [user_confirm] confirm_slip -> sign -> [paypal_approval] complete_signing
  -> shop (agent builds options[])                                   <- changed
  -> [user_confirm stage "cart"] confirm_cart { approved, optionId?, via?, attestations? }   <- changed
  -> settle -> [user_upload] verify_delivery -> refund | [user_confirm] confirm_refund -> refund | done
```

## Data

```ts
// src/pipelines/shop/types.ts
export const MAX_OPTIONS = 3;

export interface ShopOption {
  id: string;              // "opt-1", "opt-2", ... in proposal order
  rank: number;            // 1-based position after sorting (WITHIN first, then ASK, proposal order inside each)
  proposal: NewProposal;   // what the guard evaluated
  lines: CartLine[];
  verdict: Verdict;        // decision is "within" or "ask", never "outside"
  rationale: string;       // the agent's one-line reason; display only
}

export interface RuledOut {
  title: string;           // joined line titles, quoted from listings
  amount: Money;
  clauseIds: string[];     // from verdict.violations
}

// ShopState gains:
options: ShopOption[];
ruledOut: RuledOut[];
chosenOptionId: string | null;

// ConfirmCartSignalSchema gains:
optionId: z.string().min(1).optional()
```

`state.cart`, `state.cartLines` and `state.cartVerdict` always mirror the selected option. That keeps `settle`, `refund`, the evidence pack, the voice approve path and every existing test unchanged.

## Session (tools.ts)

- `ShopSession.options: ShopOption[]` and `ShopSession.ruledOut: RuledOut[]` replace "latest non-outside cart wins".
- `propose_cart`:
  1. Same limits as today (3 proposals, ids from this run's cache only, quantities 1 to 20).
  2. A cart whose listing-id and quantity set equals an existing option is refused with `{ error: "Same cart as option N." }` and does not use a proposal.
  3. `core.evaluate` runs as today. OUTSIDE goes to `ruledOut`. WITHIN or ASK becomes a new option while `options.length < MAX_OPTIONS`.
  4. The tool result adds `optionId` (or null) and `optionsSoFar`.
- `session.cart` is kept as a getter for the default option so older callers compile.
- Sorting: WITHIN options first, then ASK, proposal order inside each group; ranks are assigned after sorting.

## Steps

| Step | CoreServices / rail calls | Change |
|---|---|---|
| `shop` | `ai.runAgent`; tools call `extractor.extract`, `core.evaluate` | Stores `options`, `ruledOut`; default option fills `cart`, `cartLines`, `cartVerdict`; no options means `no_cart` as before (`releaseRemainder`). |
| `confirm_cart` | `core.evaluate` (on switch and after attestations) | Unknown `optionId` re-waits with "That option is not on the list." A known one is re-evaluated; if it is now OUTSIDE, re-wait with the clause ids and keep the previous selection. Appends `shop.option_chosen` (actor `user`, data `{ optionId, rank, titles, amount, via }`) on approval. Attestations apply to the chosen option. |
| `settle` and later | unchanged | Captures the chosen option's total with `final_capture: true`, then `releaseRemainder`. |

## Cart wait payload

```ts
data: {
  stage: "cart",
  options: Array<ShopOption & { totals: { goods, helperFee, capture, release } }>,
  ruledOut: RuledOut[],
  selectedOptionId: string,
  // unchanged fields, all for the selected option:
  lines, cart, verdict, helper, totals, unknowns, problem, confirmLabel, declineLabel,
}
```

## Agent prompt (agent.ts)

Replace the "Propose one cart" rule with:

- "Find up to 3 different carts that each fit every clause, so the person can choose. Propose your best match for their words first. Each propose_cart call is one option."
- "Give each cart a one-line rationale a person can read. It is shown to them and is not checked by the guard."
- "Stop when you have 3 options, or when nothing else fits, then summarize the options in one line each."

Mock scripts (both red-team and clean) add, after the Clockwork Rex proposal: `inspect_listing fx-dig-kit` then `propose_cart [{ fx-dig-kit, 1 }]` with a rationale about a hands-on fossil dig for a 6-year-old. Red team uses proposals 1 (hijack, OUTSIDE), 2 (Rex), 3 (dig kit). The helper hire stays after the options.

## UI (src/app/p/shop)

- New `OptionsPanel` in `panels.tsx`, rendered by `shop-console.tsx` at `confirm_cart`. `role="radiogroup"`, arrow keys move selection, each card is `role="radio"` with `aria-checked`. Stamp uses the existing `VerdictStamp`. The agent's reason sits under a small "Agent's note (not checked by the guard)" label.
- The selected card drives the existing cart totals and Approve button ("Approve option 2"). The ASK attestation form shows the selected option's unknowns.
- "Ruled out by the guard" list below the cards: title, amount, OUTSIDE stamp, clause ids.
- Paper-slip palette from `docs/CONVENTIONS.md`; `aria-live="polite"` on the selected option's stamp.

## Voice (voice.ts, voice-controls.tsx)

`parseVoiceCommand` gains `{ kind: "choose_option", index }` for "option two", "option 2", "pick option 2", "choose the second option" (1 to 3; ordinals first to third, numbers one to three). A negation before the verb returns null, like the cart verbs. The console maps the index to `options[index - 1].id`.

## Failure and abuse paths

- Hijacked listing: still OUTSIDE (c1, c2, integrity), lands in `ruledOut`, never selectable.
- Forged `optionId` from the client: re-wait, no state change, no capture.
- Client sends an `optionId` whose cart went OUTSIDE since the wait (for example the slip expired): re-evaluation catches it and re-waits; `settle` re-checks again anyway.
- Agent proposes the same cart twice: refused, no proposal spent.
