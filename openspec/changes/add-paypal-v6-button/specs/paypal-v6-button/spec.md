# Spec delta: paypal-v6-button

## Purpose

The shop buyer signs the slip with the PayPal JS SDK v6 button on the page, with the approve link as a fallback.

## ADDED Requirements

### Requirement: The server says whether v6 can run

`GET /api/paypal/sdk-config` SHALL return `{ available: false }` on the mock rail and, on the sandbox rail, `{ available: true }` with the SDK URL and the public `PAYPAL_CLIENT_ID` (PayPal's v6 set-up page names `clientId` as the credential for one-time payments; see design.md "Sources"). The response MUST NOT contain the client secret or an access token for REST calls, and MUST be marked `no-store`. A sandbox rail with no usable client ID MUST answer `{ available: false }` so the page falls back to the link.

#### Scenario: Mock rail

- **WHEN** the runtime uses the mock rail
- **THEN** `sdk-config` returns `{ available: false }`

#### Scenario: Sandbox rail without a client ID

- **WHEN** the runtime uses the sandbox rail and `PAYPAL_CLIENT_ID` is blank
- **THEN** `sdk-config` returns status 200 with `available: false`
- **AND** no response body from `sdk-config` contains `PAYPAL_CLIENT_SECRET`

### Requirement: Approval from the button resumes the signing step

`POST /api/paypal/approve` SHALL find the slip that owns the given order id and resume its waiting run with `{ approved: true, orderId }`, the same signal the return route sends. An order id that belongs to no slip MUST get 404 and resume nothing. A slip with no waiting run MUST get 409.

#### Scenario: Button approval places the hold

- **WHEN** a shop run waits at `complete_signing` and `POST /api/paypal/approve` is called with its order id
- **THEN** the order is authorized, the slip is `active` with Held $60.00, and the run moves on to shopping

#### Scenario: Unknown order id

- **WHEN** `POST /api/paypal/approve` is called with `{ orderId: "NOT-A-REAL-ORDER" }`
- **THEN** the response is 404 and no run changes state

#### Scenario: Double approval

- **WHEN** the same order id is approved twice
- **THEN** the second call answers 409 and the slip's ledger has exactly one authorization

### Requirement: The link stays as the fallback

The shop's sign step SHALL render the v6 button only when `sdk-config` reports it available and PayPal reports the PayPal method eligible. Otherwise, and on any SDK load or session error, it SHALL render the existing approve link. While the button shows, a secondary link to PayPal's page SHALL remain. Pipelines that don't opt in MUST keep the link unchanged.

#### Scenario: Mock mode shows the link

- **WHEN** the shop run waits at `sign` in mock mode
- **THEN** the page shows the "Sign with PayPal" link to the mock approve page and loads no PayPal script

#### Scenario: Order id from the approve link

- **WHEN** `orderIdFromApproveUrl("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T")` is called
- **THEN** it returns `5O190127TN364715T`, and a URL without `token` returns null
