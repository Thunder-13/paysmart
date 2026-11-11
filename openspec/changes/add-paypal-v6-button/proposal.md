# Proposal: sign the shop slip with the PayPal JS SDK v6 button

## Why

The shop flow says the buyer approves the hold with the PayPal JS SDK v6 button. Today the "Sign with PayPal" control is a plain link that sends the buyer away to PayPal's page and back through `/api/paypal/return`. The v6 button keeps the buyer on the slip, opens PayPal in a popup or modal, and returns the approval to the page. The link stays as the fallback, so mock mode, a blocked script or an ineligible browser still work.

## What changes

- Shop signing renders the v6 PayPal button when the server runs the sandbox rail. The order is still created by the `sign` step (Orders v2, intent AUTHORIZE, slip budget); the button starts a one-time payment session for that existing order id.
- `onApprove` calls a new `POST /api/paypal/approve` with the order id. The server finds the slip by that order id, resumes its waiting run with `{ approved: true, orderId }`, and `complete_signing` authorizes the order as today. The hold sits at PayPal before the agent runs.
- New `GET /api/paypal/sdk-config` tells the browser whether v6 is available and gives it what the SDK needs to start (a client ID or a server-issued client token, whichever PayPal's current v6 reference requires for one-time payments).
- `PayPalRail.createClientToken` (optional, sandbox only) issues a browser-safe client token when that path is needed. The mock rail doesn't have it.
- `SignWithPayPal` gains an opt-in `sdk="v6"` prop. Only the shop console passes it. Other pipelines keep the link.
- Fallback: in mock mode, when the script fails to load, when PayPal reports the method ineligible, or on an SDK error, the existing link is shown. With v6 showing, a small "Open PayPal's page instead" link stays under the button.

## Capabilities

### New capabilities

- `paypal-v6-button`: in-page PayPal approval for the shop slip with a link fallback.

### Modified capabilities

None archived. Builds on `add-core-platform` (rail, return route) and `add-shop-pipeline` (`sign`, `complete_signing`).

## PayPal APIs exercised

- PayPal JS SDK v6 core script, SDK instance, eligibility check, one-time PayPal payment session.
- OAuth2 token endpoint for a client token, if the v6 reference requires one.
- Orders v2 create (AUTHORIZE) and authorize, unchanged.

## AI capabilities exercised

None.

## Impact

- New: `src/components/paypal-v6-button.tsx`, `src/app/api/paypal/sdk-config/route.ts`, `src/app/api/paypal/approve/route.ts`, tests.
- Changed: `src/core/rail/sandbox.ts` (client token), `src/components/sign-with-paypal.tsx` (prop), `src/app/p/shop/shop-console.tsx` (one prop), `src/core/contracts.ts` (optional rail method, orchestrator-owned, already added), `next.config.ts` only if it sets a CSP.
- No new dependencies (the SDK loads from PayPal at runtime). No new env vars.

## Non-goals

- v6 in the bounty, second-look or toll-road pipelines.
- Venmo, Pay Later, card fields or Fastlane.
- Live (production) PayPal. The SDK URL is the sandbox one, like the REST base.
- Creating the order from the browser. The server's `sign` step stays the only place an order is made.
