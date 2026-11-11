# Spec delta: affiliate-links

## Purpose

Retailer links the app shows carry the owner's affiliate ID, read from a database, so each referred purchase can earn a commission without changing the buyer's price or the guard's decision.

## ADDED Requirements

### Requirement: Affiliate accounts live in the database

The system SHALL store affiliate accounts in the SQLite store through `store.collection("core", "affiliate_accounts")`. Each account MUST name a network (`amazon`, `flipkart`, `myntra`, `instagram`, `facebook` or `generic`), a tracking ID, one or more domains, and either link parameters or an https deep-link template containing `{url}`. Accounts for `myntra`, `instagram`, `facebook` and `generic` MUST NOT be saved without owner-supplied parameters or a template.

#### Scenario: Amazon account from the preset

- **WHEN** an account is created with `{ network: "amazon", trackingId: "leoshop-21" }`
- **THEN** it is saved with the Amazon preset domains and params `{ tag: "{id}" }`
- **AND** it is returned by `affiliateRepo(store).list()` after the store is reopened from the same file

#### Scenario: Instagram account with no link

- **WHEN** an account is created with `{ network: "instagram", trackingId: "leo.gifts" }` and no params or template
- **THEN** creation fails with a message that Instagram needs a template or parameters from the owner's program

#### Scenario: Template that is not https

- **WHEN** an account is created with template `http://links.example/?u={url}`
- **THEN** creation fails and nothing is saved

### Requirement: Links are rewritten deterministically from the stored ID

`affiliateLink(url, accounts)` SHALL return the affiliate URL for the active account whose domain matches the URL's host exactly or as a parent domain, preferring the longest match. Params mode MUST set each parameter, replacing any existing value of the same key. Template mode MUST substitute the encoded original URL and tracking ID. The function MUST NOT perform network calls or read listing descriptions, and the same input MUST give the same output.

#### Scenario: Amazon tag added

- **WHEN** `https://www.amazon.in/dp/B0TEST?th=1` is rewritten with an active Amazon account `leoshop-21`
- **THEN** the result has query `th=1` and `tag=leoshop-21` on host `www.amazon.in`

#### Scenario: Someone else's tag replaced

- **WHEN** `https://www.amazon.com/dp/B0TEST?tag=other-20` is rewritten with account `leoshop-21`
- **THEN** the result has exactly one `tag` parameter with value `leoshop-21`

#### Scenario: Look-alike host

- **WHEN** `https://notamazon.in/dp/X` or `https://amazon.in.evil.example/dp/X` is rewritten
- **THEN** the result is null

#### Scenario: Inactive account

- **WHEN** the only matching account has `active: false`
- **THEN** the result is null

### Requirement: Only the owner can change affiliate accounts

The `/api/affiliates` routes SHALL require `Authorization: Bearer <AFFILIATE_ADMIN_SECRET>`. With the secret unset they MUST answer 404, and with a wrong or missing bearer they MUST answer 401 and change nothing.

#### Scenario: No secret configured

- **WHEN** `AFFILIATE_ADMIN_SECRET` is empty and `POST /api/affiliates` is called
- **THEN** the response is 404 and no account is created

#### Scenario: Wrong bearer

- **WHEN** the secret is set and a request sends a different bearer
- **THEN** the response is 401 and the account list is unchanged

### Requirement: Shop links carry the affiliate ID, and the agent can't touch them

The shop session SHALL load active affiliate accounts before its first search and attach an affiliate link to every listing whose URL matches an account. Tool results returned to the agent MUST NOT include affiliate URLs, tracking IDs or account IDs. The guard verdict for a cart MUST be identical with and without affiliate accounts. After a successful capture the slip's ledger SHALL record `affiliate.attributed` for each line with an affiliate link, including the estimated commission when a rate is stored; after a refund it SHALL record `affiliate.reversed`. Pages showing affiliate links MUST show a commission disclosure and mark links `rel="sponsored"`.

#### Scenario: Demo cart attributed

- **WHEN** the demo account (generic, `ref={id}`, 4%) exists and the clean demo run captures Clockwork Rex at $42.18
- **THEN** the cart line's affiliate URL is `https://dinodepot.example/p/fx-clockwork-rex?ref=permission-slip-demo`
- **AND** the ledger has `affiliate.attributed` with estimated commission $1.68

#### Scenario: Agent never sees the tag

- **WHEN** the agent calls `search_products` and `inspect_listing` with an active account in the store
- **THEN** no tool result string contains the tracking ID, the account id or `ref=`

#### Scenario: Guard unchanged

- **WHEN** the same cart is evaluated once with no accounts and once with an account matching its retailer
- **THEN** both verdicts have the same decision, violations and unknowns

#### Scenario: Refund reverses the estimate

- **WHEN** the delivery check finds a breach and the refund succeeds
- **THEN** the ledger has `affiliate.reversed` and `state.affiliate.reversed` is true
