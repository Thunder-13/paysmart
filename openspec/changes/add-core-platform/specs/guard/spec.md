# guard

## Purpose

The Guard decides whether a proposal fits a signed slip. It is pure and deterministic: no I/O, no model calls, time from the caller. It decides on extracted facts. The only raw text it reads is the item title, matched against one fixed multi-pack pattern that can only move a verdict to ask; titles are also quoted in violation messages.

## ADDED Requirements

### Requirement: Decision precedence

The guard SHALL return "outside" when any clause is violated, "ask" when nothing is violated but a needed fact is unknown, and "within" otherwise, with checkedAt taken from ctx.now. Identical inputs MUST give identical verdicts.

#### Scenario: Violation beats unknown
- **WHEN** a proposal breaks the budget and its category is unknown
- **THEN** the decision is outside and the unknown is still listed

### Requirement: Clause checks

The guard SHALL check each clause kind as follows:
budget_max fails when proposal amount plus committed spend exceeds the amount (and on a currency mismatch);
quantity_max sums quantity times itemCount, treating an unknown count as 1 and asking only when the title looks like a multi-pack;
category_in compares case-insensitively and asks on a null category;
deliver_by compares the ISO day of each delivery estimate and asks when it is missing;
exclude_attribute fails on a listed value and asks when the attribute is missing or null;
payee_allowlist compares email or merchant id case-insensitively and, for payouts, checks every receiver;
require_evidence passes on a "pass" ref, fails on "fail", and asks when the ref is missing or "unknown";
rate_card caps each item's unit price (and an item-less metered charge), but not settlement payouts against a per-fetch card;
split_rule fails when weights do not sum to 10000 and, for payouts, when a receiver has no share or gets more than one cent away from its share;
expires_at fails after the end time.
Clauses that do not apply to a proposal kind MUST be skipped (product-fact clauses on payouts, budget on refunds).

#### Scenario: Battery toy
- **WHEN** the slip says "Nothing that needs batteries" and the item's power_source is "Battery"
- **THEN** the verdict is outside with a message that starts with "Nothing that needs batteries"

#### Scenario: Missing delivery date
- **WHEN** deliver_by is 2026-11-21 and the item has no delivery estimate
- **THEN** the verdict is ask with field deliveryEstimate

#### Scenario: Uneven split
- **WHEN** a 70/30 split pays $6.00 and $4.00 out of $10.00
- **THEN** both receivers get a split_rule violation

### Requirement: Integrity check against prompt injection

Any item whose facts have injectionSuspected true SHALL produce a violation with clauseId "integrity" and the message "Listing text tried to give the agent instructions".

#### Scenario: Injected listing
- **WHEN** a listing's extracted facts are flagged as injection
- **THEN** the verdict is outside regardless of price and the first violation is the integrity line

### Requirement: Plain-words messages

Every violation and unknown message SHALL start with the cited clause's label and use everyday words and formatted amounts (for example "$30.00"), so the UI can show "c2 · <message>".

#### Scenario: Budget message
- **WHEN** $30.01 is proposed against "Spend at most $50" with $20.00 spent
- **THEN** the message names the label, the $30.01 needed and the $29.99 left
