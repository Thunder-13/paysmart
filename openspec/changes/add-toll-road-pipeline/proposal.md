# Proposal: add the Toll Road pipeline

## Why

AI agents read the web for free, and the people who write it get nothing back. Toll Road puts an HTTP 402 Payment Required booth in front of content: an agent pays per fetch under a Permission Slip its operator signed, and the money settles on PayPal.

Prior art exists and we say so. Cloudflare Pay per crawl answers crawlers with 402 and a price, then bills them through Cloudflare. Coinbase's x402 protocol settles 402 payments in stablecoins. Toll Road is the PayPal-rails version: the operator signs a plain-words mandate with a hard budget and a per-fetch price cap, PayPal holds that budget as an authorization, and publishers get paid through PayPal Payouts. The agent needs no wallet, and every charge traces back to a sentence its operator signed.

## What changes

- New pipeline `toll-road` registered under the existing stub id (`src/pipelines/toll-road/**`).
- Publisher catalog: 3 fictional publishers, 6 original sample articles, each with its own price per fetch and a PayPal payout email. A small registration path lets a publisher add content, a price and an email.
- Toll booth gateway `GET /api/p/toll-road/content/[id]`:
  - with no `x-permission-slip` header it answers HTTP 402 with a JSON price quote and `WWW-Authenticate: PermissionSlip realm="toll-road"`;
  - with an active toll slip it checks the fetch with the pure guard, records a meter, and returns the article.
- Toll slip: the operator signs a slip with `budget_max`, a `rate_card` (unit `fetch`, per-fetch price cap) and `expires_at`. Signing is a PayPal AUTHORIZE order.
- Metering: each fetch becomes a `metered_charge` proposal checked by the pure guard against settled spend plus meters so far. Nothing touches PayPal per fetch. Refusals come back as 402 with a reason: budget exhausted, price above cap, or slip expired.
- Research crawler: an AI agent with `fetch_article`, `list_catalog` and `finish` tools answers a research question, paying per fetch until the answer is done or the budget runs out. On a budget or expiry 402 it stops and asks the operator to sign a new slip.
- Quarantined reading: article text goes through a no-tool structured AI call that returns notes and an injection flag. The research agent sees notes, and the guard never sees article text.
- Settlement: one capture against the toll slip for the metered total (final capture), then release of the remainder.
- Network payout slip: a second slip owned by "Toll Road network" with budget equal to the captured total, a `split_rule` weighted by usage in basis points that sum to 10000, and a `payee_allowlist` of the publishers. One Payouts batch pays them.
- UI page `/p/toll-road`: publisher cards with price per fetch, the raw 402 response in a curl-style panel, a crawler activity stream with per-fetch stamps, live counters (fetches, spent, remaining, per-publisher earnings), slip cards for both slips, and the ledger timeline.

## Capabilities

### New capabilities

- `toll-road-pipeline`: HTTP 402 metered content access for AI agents under a signed toll slip, guarded per-fetch metering, single-capture settlement on PayPal, and usage-weighted publisher payouts through a network payout slip.

### Modified capabilities

None. The pipeline builds on core services and the frozen contract without changing either.

## PayPal APIs and AI capabilities exercised

- Orders v2: create an AUTHORIZE-intent order for the toll slip, buyer approval, authorize.
- Payments v2: capture the authorization once with `final_capture: true`, void the remainder.
- Payouts v1: one batch from the network payout slip, one item per publisher.
- AI, mandate compiler: plain words to `budget_max`, `rate_card` and `expires_at` clauses (core `compileSlip`, deterministic mock).
- AI, tool-using agent: the research crawler (`ai.runAgent`, smart tier, scripted mock that replays through the real tools, gateway and guard).
- AI, quarantined reader: a no-tool `ai.json` call (fast tier) that turns untrusted article text into notes plus an injection flag.

## Impact

- Code: `src/pipelines/toll-road/**` (replaces the stub), `src/app/p/toll-road/**`, `src/app/api/p/toll-road/**`. No edits outside owned paths.
- Data: pipeline collections `publishers`, `content` and `meters`. Ledger event types `toll-road.metered`, `toll-road.refused`, `toll-road.injection_flagged`, `toll-road.crawl_finished`, `toll-road.settled` and `toll-road.payout_split`, plus core `guard.verdict` events written for each fetch.
- Depends on core: `@/core/money`, `@/core/ids`, `@/core/guard`, `@/core/testing`, `@/server/runtime`, the run client and the shared UI kit. Open questions for the core agent are listed in design.md.
- Public HTTP surface under `/api/p/toll-road/`: the 402-speaking booth (`GET content/[id]`), the public price list (`GET content`) and registration (`POST content`).

## Non-goals

- Crawling third-party sites. The booth guards only content registered in the catalog.
- A PayPal call per fetch. Fees would eat a 3-cent charge, so fetches are metered locally and settled once.
- Crypto, stablecoins, or the x402 wire format. The 402 body is our own JSON shape.
- Crawler identity checks (signed bot headers, robots.txt policy).
- Publisher onboarding or KYC beyond a name, a price and a payout email.
- Topping up a slip mid-run. The operator signs a new slip in a new run.
- A network fee. Publishers receive 100% of captured tolls.
- Refunds for content the agent did not like.
