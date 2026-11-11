# Design: PayPal JS SDK v6 button

## Step graph (shop, unchanged steps, new resume path)

```
sign  --(order AUTHORIZE created, wait paypal_approval { approveUrl, orderId })-->
   browser, v6:   <paypal-button> -> session.start(existing orderId) -> onApprove
                  -> POST /api/paypal/approve { orderId } -> orchestrator.beginResume(run, { approved: true, orderId })
   browser, link: approveUrl -> PayPal page -> GET /api/paypal/return (unchanged)
-> complete_signing (core.completeSigning -> rail.authorizeOrder) -> shop
```

Both paths resume the same step with the same signal, so `complete_signing` and the ledger don't change.

## Grounding

The worker MUST read PayPal's current v6 docs before coding and list the URLs and access date under "Sources" at the end of this file. Starting points: https://developer.paypal.com/sdk/js/set-up, https://docs.paypal.ai/reference/sdk/js/v6/reference, https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6/paypal-checkout. Known from a search on 2026-11-09, to confirm: the sandbox core script is `https://www.sandbox.paypal.com/web-sdk/v6/core`; `window.paypal.createInstance({ ..., components: ["paypal-payments"], pageType: "checkout" })`; `findEligibleMethods({ currencyCode: "USD" })` decides whether to show the button; `createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })` and `session.start({ presentationMode: "auto" }, Promise.resolve({ orderId }))`. The docs disagree on whether one-time payments need a server `clientToken` or accept a `clientId`; use what the reference says for one-time PayPal payments and note it here.

## Server

| Piece | Behavior |
|---|---|
| `rail.createClientToken({ domains })` (sandbox.ts) | Only if a token is needed: `POST {base}/v1/oauth2/token`, basic auth, form body `grant_type=client_credentials&response_type=client_token&intent=sdk_init` plus `domains[]` from the app base URL host (confirm the parameters against the docs). Returns `{ clientToken, expiresIn }`. Never logs the token. Uses the rail's injectable `fetch`. |
| `GET /api/paypal/sdk-config` | Mock rail: `{ available: false }`. Sandbox: `{ available: true, sdkUrl, clientId? , clientToken?, expiresIn? }`. Client token cached in memory until 60 s before expiry. A token error gives `{ available: false, reason }` with status 200, so the page falls back to the link. Never returns the client secret. `Cache-Control: no-store`. |
| `POST /api/paypal/approve` | Body `{ orderId }` (zod, non-empty, at most 64 chars). `store.slips.findByRailId(orderId)`; unknown gives 404. Waiting run for that slip via `runForSlip` from `@/server/http`; resume with `beginResume(run.id, { approved: true, orderId })` and `after(() => settle(done))`, the same pattern as the return route. Answers `{ runId, returnPath }`. No waiting run (double approve) gives 409 with the latest run id. The order's own PayPal approval is what makes `authorizeOrder` succeed, so a forged call can't create a hold. |

## Client

- `src/components/paypal-v6-button.tsx` (`"use client"`): props `{ approveUrl, orderId?, label? }`. `orderId` defaults to the `token` query parameter of `approveUrl` (pure helper `orderIdFromApproveUrl`, unit tested). Flow: fetch `/api/paypal/sdk-config`; if unavailable, render the link. Else inject the script once (module-level promise), create the instance, check eligibility, render `<paypal-button type="pay">` (declare the custom element type for TSX), and on click start the session with the existing order id. `onApprove` posts to `/api/paypal/approve`, then navigates to `returnPath` with `run=<runId>` (or `router.refresh()` when already there). `onCancel` leaves the slip unsigned and shows "You closed PayPal. Your slip isn't signed yet." `onError` and any thrown error switch to the link and show a short reason in an `aria-live` region.
- `SignWithPayPal` gains `sdk?: "v6"`; with it set it renders `PayPalV6Button`, otherwise the current link, unchanged. The link markup moves into a small internal component that both paths reuse.
- Shop console passes `sdk="v6"` at the `sign` wait. (Orchestrator does this one-line edit, since `shop-console.tsx` belongs to the shop worker.)
- If `next.config.ts` sets a Content-Security-Policy, allow the PayPal sandbox script and frame origins the docs list. If it sets none, change nothing.

## Failure and abuse paths

- Mock mode: `sdk-config` says unavailable; the link to the mock approve page shows; every existing test and the demo seed run unchanged.
- Script blocked or offline: load promise rejects; link shown.
- Buyer closes the popup: run keeps waiting at `complete_signing`; the button can be clicked again.
- `POST /api/paypal/approve` with an order id that belongs to no slip: 404, nothing resumed.
- Double approve (button then link return, or two clicks): the second resume gets 409 and the page shows the run's state.
- Client token request fails: link shown; the token and secret never reach logs or responses.
- Stale links: the return, cancel and approve routes resume a run only while it waits on `paypal_approval`. A return or cancel link used after the run reached the cart wait just redirects to the run's current state, so it can't approve or decline the cart or void the hold.

## Sources

Accessed 2026-11-09. Fetched by the implementing worker.

- https://developer.paypal.com/sdk/js/set-up loaded. Confirms: sandbox core script `https://www.sandbox.paypal.com/web-sdk/v6/core`; `window.paypal.createInstance({ clientId, components: ["paypal-payments"] })`. Credential choice: the page recommends `clientId` for most integrations and names one-time payments among them. It says `clientToken` is for Fastlane only. `clientId` is safe in front-end code. Decision: use `clientId` (from `PAYPAL_CLIENT_ID`), so no client token is issued and `createClientToken` is not implemented (task 2.1). For reference, the page's token request is `POST /v1/oauth2/token` with `grant_type=client_credentials`, `response_type=client_token`, `domains[]=...`. The page contradicts itself on token lifetime (15 minutes in the parameter text, `expires_in` 32400 in the sample).
- https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6/paypal-checkout answered 301 to https://developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout, which loaded. Confirms: sandbox script URL as above (live URL not stated on that page); `createInstance({ clientId, components: ["paypal-payments"] })` with no `pageType` and no `clientToken`; `sdkInstance.findEligibleMethods()` then `eligibility.isEligible("paypal")`; `sdkInstance.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })`; `session.start({ presentationMode: "auto" }, createOrderPromise)`; `document.createElement("paypal-button")` with a click listener that starts the session. Its example creates the order in the browser through its own `/api/orders`; this change passes a promise for the order id the server already made.
- https://docs.paypal.ai/reference/sdk/js/v6/reference answered 301 to https://developer.paypal.com/docsai/reference/sdk/js/v6/reference, which loaded but truncated before the `createInstance` section, so the reference itself does not settle clientId versus clientToken here; the set-up page above does. From the part that loaded: `findEligibleMethods({ currencyCode, countryCode?, amount? })` (currencyCode defaults to "USD") returns `{ isEligible(method), getDetails(method) }`; `onApprove` receives `orderId` and `payerId`, `onCancel` receives `orderId` if one exists, `onError` receives `code` and `message`; `session.start(options?, orderPromise)` with `presentationMode` of `auto` (default), `popup`, `modal`, `redirect` or `payment-handler`; the orderPromise must resolve to `{ orderId }`; `<paypal-button type="pay|checkout|buynow|subscribe">` with a color class such as `paypal-gold`. Its examples show `pageType: "checkout"` in `createInstance`; the set-up and checkout pages omit it, so the code omits it.
- Not tested: no live sandbox signing was run (PayPal keys are empty in the build environment). The exact sandbox frame origins for a CSP were not listed on the pages read; `next.config.ts` sets no CSP, so nothing changes there.
