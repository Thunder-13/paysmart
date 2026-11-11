# paypal-rail

## Purpose

One PayPal interface with two implementations: a typed REST client for the PayPal sandbox, and an offline mock with the same state machine and error codes, so every pipeline runs with or without keys.

## ADDED Requirements

### Requirement: Mode selection

The server SHALL use the sandbox client only when PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set (and PAYPAL_MODE is not "mock"); otherwise it MUST use the mock rail. GET /api/health MUST report the mode.

#### Scenario: Missing secret
- **WHEN** PAYPAL_MODE is sandbox but PAYPAL_CLIENT_SECRET is empty
- **THEN** the rail mode is mock

### Requirement: Sandbox REST client

The sandbox client SHALL authenticate with OAuth2 client credentials and reuse the token until a minute before it expires, send a PayPal-Request-Id header on every POST (the proposal-derived id for authorization captures, the sender batch id for payouts), and call: Orders v2 create (payment_source.paypal.experience_context with return_url, cancel_url, user_action; purchase_units with payee email_address or merchant_id, custom_id, description), get, authorize, capture, track; Payments v2 capture authorization (amount, final_capture, invoice_id, note_to_payer), void, reauthorize, refund; Payouts v1 create and get; Reporting transactions in 31-day windows with paging, fields=all and signed amounts; Invoicing v2 list and remind; Disputes v1 list, get, provide-evidence as multipart (an "input" JSON part with evidence_type plus files) and accept-claim; and verify-webhook-signature.

#### Scenario: Order creation
- **WHEN** a slip is sent for signing in sandbox mode
- **THEN** PayPal receives POST /v2/checkout/orders with the slip id as custom_id and the app's return URL, and the payer-action link becomes the approve URL

#### Scenario: Long reporting range
- **WHEN** transactions are requested for 45 days
- **THEN** the client makes one call per 31-day window and pages until total_pages

### Requirement: PayPal errors keep their details

Any non-2xx response SHALL throw PayPalError carrying PayPal's name, message, issue details, HTTP status and debug_id, and the error message MUST include the name and debug_id.

#### Scenario: Over-capture in the sandbox
- **WHEN** PayPal answers 422 MAX_CAPTURE_AMOUNT_EXCEEDED with debug_id f00dbabe
- **THEN** the thrown error message contains "UNPROCESSABLE_ENTITY" and "debug_id f00dbabe" and error.issue is MAX_CAPTURE_AMOUNT_EXCEEDED

#### Scenario: Reporting not enabled
- **WHEN** the account lacks the Transaction search permission and PayPal returns NOT_AUTHORIZED
- **THEN** the error message contains NOT_AUTHORIZED so the UI can explain the setting

### Requirement: Offline mock with PayPal's state machine

The mock SHALL mint PayPal-looking ids and enforce: orders CREATED, APPROVED, COMPLETED (or VOIDED when cancelled); authorizations CREATED, PARTIALLY_CAPTURED, CAPTURED or VOIDED; no capture beyond the remaining authorized amount, after a void, or after a final capture; no duplicate invoice_id; refunds capped at the captured amount; payouts that succeed and reject a reused sender batch id; disputes that move to UNDER_REVIEW on evidence and RESOLVED on acceptance. Its approve URL MUST be <baseUrl>/mock-paypal/approve?token=<orderId>, verifyWebhook MUST return true, and it MUST log every rail call through calls().

#### Scenario: Capture after void
- **WHEN** a voided authorization is captured
- **THEN** the mock throws PayPalError with issue AUTHORIZATION_VOIDED

#### Scenario: Refund too large
- **WHEN** $20.01 is refunded from a $30.00 capture that already refunded $10.00
- **THEN** the mock throws REFUND_AMOUNT_EXCEEDED

### Requirement: Seeded data for offline demos

The mock SHALL start with 90 days of transactions, four invoices and two disputes, and seedTransactions, seedInvoices and seedDisputes MUST upsert by id.

#### Scenario: Reseeding a dispute
- **WHEN** a dispute is seeded again with the same id and a new reason
- **THEN** the list keeps one copy with the new reason
