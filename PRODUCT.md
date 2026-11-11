# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: judges of the PayPal AI Hackathon on Devpost (confirmed 2026-11-09). They open a fresh deploy, often in mock mode, and have a few minutes per project. Their first action is to load the demo story and open a finished pipeline run.

Secondary: developers reading how the guard works, and PayPal staff checking which PayPal APIs each pipeline exercises.

## Product Purpose

PaySmart is where a person says what they need in plain words and PayPal pays only for the cart they pick. Its engine, Permission Slip, is a trust layer for money that AI agents move on PayPal. A person writes what the agent may do in plain words; the app compiles that into numbered clauses (c1, c2, ...), the person signs the slip with PayPal, and PayPal holds the money. A deterministic guard checks every agent move against the clauses using facts extracted from the data, and every verdict and PayPal call lands in a hash-chained ledger, one chain per slip, that anyone can re-verify.

Success: a judge types an ask on the first screen, understands the mechanism within one screen of scrolling and sees it work on a real run.

## Positioning

The guard is a pure function from (slip, proposal, spent, now) to a verdict: within, outside or ask. It calls no model, so a prompt-injected listing cannot talk past it; the worst injected text can do is produce wrong facts that the clauses then reject. Every decision is provable after the fact through the per-slip hash chain.

## Operating Context

One orchestrator runs seven pipelines, each at /p/<id>: PaySmart, the front door, and the six inside it: Shop, Second Look, Bounty Board, Cash Weather, Toll Road, Dispute Desk. Nine ideas from docs/IDEATION.md map onto them (docs/IDEAS.md). Runs wait on people at named steps (PayPal approval, user confirm, upload, external event) and resume through POST /api/runs/<id>/resume. Mock mode runs fully offline with a stateful PayPal mock and a scripted AI; sandbox mode uses PayPal sandbox REST APIs.

## Capabilities and Constraints

- Next.js 16, React 19, Tailwind 4, SQLite via node:sqlite; Node 22.13 or newer.
- PayPal Orders v2 (AUTHORIZE and CAPTURE), Payments v2 capture, void and refund, Payouts v1, order tracking, disputes.
- Ten clause kinds: budget_max, quantity_max, category_in, deliver_by, exclude_attribute, payee_allowlist, require_evidence, rate_card, split_rule, expires_at.
- Verdicts: within, outside (a clause broken), ask (a fact the slip depends on is unknown, a person decides). The synthetic integrity clause catches prompt injection.
- The home page "Load the demo story" button exists only in mock mode.

## Brand Commitments

- The product name is PaySmart; its line is "Say what you need. PayPal pays only for the cart you pick." Permission Slip names the engine inside it: the signed mandate with numbered clauses, its guard, the slip card and the hash-chained ledger. Its line is "Every dollar an AI touches carries a signed Permission Slip."
- The visual world follows PayPal's own colour system (PayPal60, fetched 2026-11-09, see .hallmark/brand-spec.md), by the user's request: "stick onto the theme of PayPal, but far better and more advanced."
- Hackathon rules forbid using third-party IP without permission: never redraw the PayPal logo and never ship PayPal's licensed faces (PayPal Pro, PayPal Open). PayPal's name appears only as plain text where the product truly uses PayPal, and PayPal's own SDK buttons render where the integration already uses them.

## Evidence on Hand

- Real figures come only from the running ledger (lib: src/server/ledger-figures.ts, src/server/featured-runs.ts) and the demo story (npm run demo:seed). The demo Shop run: a planted listing tries to hijack the agent into a $419.96 cart, the guard stamps it OUTSIDE (c1, c2, c3 and integrity); Clockwork Rex at $42.18 is within.
- Absent: testimonials, customer logos, usage metrics, press. None may be invented.

## Product Principles

1. Show the mechanism working, never describe it in the abstract.
2. Every figure on screen is read from the ledger or the slip; nothing is decorative data.
3. The guard's verdict is the loudest thing on any screen it appears on.
4. Anything a judge needs to try must be one click from the first screen.
