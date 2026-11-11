# Proposal: let the person choose between guard-stamped options

## Why

Today the shopping agent proposes one cart and the person can only approve it or decline it. The agent made the choice. For a gift, the person knows Leo; the agent doesn't. The agent should do the searching and the checking, then hand back a short list of carts that each passed the guard, and the person picks one. The guard stays where it is: every option carries its own stamp, and an option can only reach the list if its stamp is WITHIN or ASK.

## What changes

- `propose_cart` collects options. Each call that the guard stamps WITHIN or ASK becomes one option (at most 3). A call stamped OUTSIDE is recorded as "ruled out" with the clause ids it broke. The proposal limit stays at 3, so the red-team flow (1 hijacked cart, then 2 clean ones) still fits.
- The agent prompt asks for up to 3 distinct carts, best match first, each with a one-line reason. The reason is shown to the person and plays no part in the check.
- The `confirm_cart` wait carries `options[]`, `ruledOut[]` and `selectedOptionId`. The existing `lines`, `cart`, `verdict` and `totals` fields keep describing the selected option, so current callers keep working.
- The `confirm_cart` resume signal accepts an optional `optionId`. Missing means the default option (the first WITHIN option, else the first ASK option). The step re-evaluates the chosen option with `core.evaluate` before it becomes the cart and records `shop.option_chosen` with actor `user`.
- The shop console shows the options as a radio group of slip-style cards: rank, title, retailer, price, the guard stamp with clause ids, the agent's reason (labelled as unchecked), and the capture and release figures for that option. A "Ruled out by the guard" list shows OUTSIDE carts with their clause ids.
- Voice (Talk to Pay): "option two", "pick option 2" and "choose the second option" select an option. "Approve cart" approves the selected one. Every voice action keeps a keyboard path.
- Mock scripts propose a second clean option (Dig-a-Saur Triceratops Fossil Dig Kit, $21.40), so the offline demo shows a real choice. The default stays Clockwork Rex at $42.18, so the demo still shows Held $60.00, Spent $42.18, Released $17.82.

## Capabilities

### New capabilities

- `shop-choices`: the agent shortlists guard-stamped options and the person picks one before checkout.

### Modified capabilities

None in `openspec/specs/` (the shop pipeline change is not archived yet). This change builds on `add-shop-pipeline`.

## PayPal APIs exercised

No new calls. The chosen option's total is what `settlePurchase` captures against the existing authorization with `final_capture: true`, and `releaseRemainder` voids the rest, as before.

## AI capabilities exercised

- Tool use: the shopping agent (`ai.runAgent`, smart tier) now returns up to 3 carts through `propose_cart`.
- Every option's facts still come from the quarantined extractor; the guard never reads the agent's reason.

## Impact

- `src/pipelines/shop/{agent,tools,steps,types,voice}.ts` and their tests, `src/app/p/shop/{shop-console,panels,voice-controls}.tsx`, `scripts/shop-smoke.ts`.
- No contract change, no new env vars, no new dependencies.

## Non-goals

- A "search again with my note" loop after the options. Declining still voids the hold.
- Mixing items from two options into one cart.
- More than 3 options or more than 3 proposals per run.
- Ranking by anything other than the agent's order plus WITHIN-before-ASK.
