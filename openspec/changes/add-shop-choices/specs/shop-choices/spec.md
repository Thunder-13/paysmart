# Spec delta: shop-choices

## Purpose

The shopping agent finds and checks products, then the person chooses which guard-stamped cart to buy.

## ADDED Requirements

### Requirement: The agent shortlists up to three guard-stamped options

The shop step SHALL collect every cart the guard stamps WITHIN or ASK as a separate option, up to 3 options per run. A cart the guard stamps OUTSIDE MUST NOT become an option and SHALL be recorded as ruled out with the clause ids it broke. Options SHALL be ordered WITHIN before ASK, keeping the agent's proposal order inside each group. The proposal limit of 3 per run SHALL stay in force.

#### Scenario: Clean demo run offers two options

- **WHEN** the demo intent runs in mock mode without red team and the slip is signed
- **THEN** the run waits at `confirm_cart` with 2 options
- **AND** option 1 is Clockwork Rex at $42.18 stamped `within` and option 2 is the Dig-a-Saur Triceratops Fossil Dig Kit at $21.40 stamped `within`
- **AND** `selectedOptionId` is option 1's id

#### Scenario: Hijacked cart is ruled out, never offered

- **WHEN** the red-team run reaches `confirm_cart`
- **THEN** `ruledOut` holds the $419.96 cart with clause ids c1, c2, c3 and `integrity`
- **AND** no option contains a planted listing
- **AND** the run used exactly 3 proposals

#### Scenario: Duplicate cart does not use a proposal

- **WHEN** the agent proposes a cart with the same listing ids and quantities as an existing option
- **THEN** `propose_cart` returns an error naming that option
- **AND** the proposal count and the options list are unchanged

### Requirement: The person chooses the option before checkout

The `confirm_cart` wait SHALL include every option with its lines, guard verdict, the agent's rationale and its own capture and release totals, plus the ruled-out carts. The resume signal MAY name an `optionId`; when it is missing the default option SHALL be used. The step MUST re-evaluate the chosen option with the guard before it becomes the cart, and MUST record `shop.option_chosen` on the slip's ledger with actor `user`. Only the chosen option's total SHALL be captured.

#### Scenario: Person picks the second option

- **WHEN** the clean demo run is resumed at `confirm_cart` with `{ approved: true, optionId: <option 2 id> }`
- **THEN** the ledger has `shop.option_chosen` with actor `user` for option 2
- **AND** settlement captures $21.40 with `final_capture` true and releases $38.60

#### Scenario: No optionId keeps the existing behavior

- **WHEN** the run is resumed at `confirm_cart` with `{ approved: true }`
- **THEN** option 1 is chosen and settlement captures $42.18 and releases $17.82

#### Scenario: Forged option id

- **WHEN** the run is resumed with `{ approved: true, optionId: "opt-99" }`
- **THEN** the run waits again at `confirm_cart` with a message that the option is not on the list
- **AND** no capture happens and the selection is unchanged

#### Scenario: Chosen option fails the re-check

- **WHEN** the person picks an option and the clock is past the slip's c6 expiry
- **THEN** the step does not move to `settle`
- **AND** the run waits again citing the failed clause ids, or ends `blocked` at settle, with the authorization voided and nothing captured

### Requirement: The options screen is accessible and honest about what is checked

The shop console SHALL show the options as a keyboard-operable radio group, each with the guard stamp and the clause ids it cites. The agent's rationale MUST be labelled as not checked by the guard. Voice SHALL accept "option N" and ordinal forms for N from 1 to 3, and a negated command MUST select nothing.

#### Scenario: Voice selects an option

- **WHEN** the transcript is "pick option 2"
- **THEN** `parseVoiceCommand` returns `{ kind: "choose_option", index: 2 }`

#### Scenario: Negated voice command

- **WHEN** the transcript is "don't pick option 2"
- **THEN** `parseVoiceCommand` returns null
