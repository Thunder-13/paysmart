# Tasks

Checks used below: `npx vitest run <file>`; "typecheck clean for X" means `npm run -s typecheck 2>&1 | grep -E "X"` prints nothing. Read `node_modules/next/dist/docs/` for route handler conventions before writing routes.

## 1. Grounding

- [x] 1.1 Read PayPal's current v6 docs and fill the "Sources" section of `design.md` (URLs, access date, client ID or client token for one-time payments, script URL, method names); verify `grep -c "https://" openspec/changes/add-paypal-v6-button/design.md` is higher than before and the section names the credential choice.

## 2. Server

- [x] 2.1 (Not needed: PayPal's set-up page says clientId covers one-time payments and clientToken is for Fastlane only, so `createClientToken` stays unimplemented and sdk-config returns the public client ID.) If the docs require a client token, implement `createClientToken` in `src/core/rail/sandbox.ts` with tests in `sandbox.test.ts` using the injected fetch; verify `npx vitest run src/core/rail/sandbox.test.ts` passes (request method, path, auth header, form fields; token never in thrown messages). If not required, mark this task done with the reason.
- [x] 2.2 Write `src/app/api/paypal/sdk-config/route.ts` with tests; verify `npx vitest run src/app/api/paypal` passes (mock gives `available: false`; sandbox with a stubbed rail gives `available: true`; token failure gives `available: false`; no secret in any body; `Cache-Control: no-store`).
- [x] 2.3 Write `src/app/api/paypal/approve/route.ts` with tests on a test runtime; verify `npx vitest run src/app/api/paypal` passes (shop run at `complete_signing` resumes and the slip becomes `active`; unknown order id 404; second call 409; exactly one `rail.authorized` style event on the ledger).

## 3. Client

- [x] 3.1 Write `src/components/paypal-v6-button.tsx` and `orderIdFromApproveUrl` (unit tested), add the `sdk` prop to `src/components/sign-with-paypal.tsx`; verify `npx vitest run src/components` passes and typecheck clean for `src/components`.
- [x] 3.2 Check `next.config.ts` for a CSP and adjust only if one exists; verify `npx eslint src/components src/app/api/paypal src/core/rail` exits 0.
- [x] 3.3 (Orchestrator; verified 2026-11-09: mock mode shows the link and reaches `confirm_cart` with no paypal.com requests; sandbox mode renders the v6 "Pay with PayPal" button after find-eligible-methods 200; the approval popup itself was not exercised) Pass `sdk="v6"` in `src/app/p/shop/shop-console.tsx`; verify a browser run in mock mode still shows the link and reaches `confirm_cart`.
- [x] 3.4 Verify `openspec validate add-paypal-v6-button --strict` passes.
