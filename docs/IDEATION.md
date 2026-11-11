# PayPal AI Hackathon: what we build and why it wins

## The call

Build **Permission Slip**: a permission slip for your AI. You write what your agent may buy in plain words. PayPal holds exactly that much money. A separate guard, one the agent can't talk to, checks every cart against your words before a cent moves. Whatever isn't spent goes back to you.

Why this one: trust is the gate on agentic commerce. PayPal's own agentic services (Agent Ready and Store Sync, Oct 28, 2025) serve merchants, and the shopper's side has no product on PayPal.

PayPal earned its name making it safe to pay strangers on eBay. The newest stranger holding your money is your own AI agent. That's the story PayPal's judges will repeat.

Prize lanes: 1st, 2nd or 3rd place. Fallback is the honorable mention Best Use of Agentic Commerce ($5k). The Channel3 sponsor prize ($1.5k, single winner) stacks on either. One project can win one Grand Prize or one Honorable Mention, plus one Sponsor Prize.

Alternate name if the team prefers: Cosign.

## 1. Problem restatement

AI agents have started spending money for people, and people don't trust them with it. Today the only rule between an agent and your money is a sentence in the agent's prompt, and any web page the agent reads can try to rewrite that sentence.

Evidence (sources in section 11):

- Feb 9, 2025: Washington Post columnist Geoffrey A. Fowler asked OpenAI's Operator to find the cheapest dozen eggs for delivery. It bought eggs on Instacart with his saved card without his approval. Eggs $13.19; total with fees and tip $31.43. Operator then misreported the total as $19.68. OpenAI said it "fell short of its safeguards."
- Aug 2025: Brave showed a malicious instruction hidden in a Reddit post could hijack Perplexity's Comet browser agent. Oct 2025 follow-up: hidden text in screenshots got read as instructions.
- Nov 2025: Microsoft Research and Arizona State's Magentic Marketplace simulation (100 customer agents, 300 business agents) found agents open to manipulation tactics including prompt injection. Smaller models fell even to psychological tactics.
- Visa Trust Index (Harris Poll, May 2026, 2,065 US adults): 23% would trust generative AI to execute a payment.
- Accenture 2026 Consumer Pulse (25,590 consumers, 16 countries): 9% would let an agent initiate and complete purchases within boundaries; 32% would let it decide within limits.
- Commerce and PayPal study (Logica Research, 3,000 consumers in US, UK, Australia, Mar to Apr 2026): about two-thirds are interested in agentic shopping, and they want visibility and control.
- Size of the prize: McKinsey (Oct 2025) says up to $1T of US B2C retail could be orchestrated by agents by 2030. Salesforce (Jan 6, 2026) says AI and agents influenced $262B of $1.29T global holiday sales, Nov 1 to Dec 31, 2025.

## 2. What the contest rewards

- 30,808 registered participants. Open theme, no tracks. The project must meaningfully use PayPal (sandbox) and AI.
- 5 criteria, equally weighted, scored 1 to 5: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation. Ties break on Technological Implementation first, then Design, Impact, Innovation, Presentation.
- Judges aren't required to run the project, so the sub-3-minute YouTube video carries a lot of the weight (the organizers' own words). Judges: PayPal DevRel (Jo Franchetti, Eddie Jaoude, Marco Podien), PayPal engineering (Karthik Ravi, Himraj Singh), PayPal product (Nathaniel Olson), plus sponsor judges (incl. Channel3's Ignacio Valdez Bicard).
- Judges have no AI API keys. Ship a hosted demo URL and keep it alive until judging ends Dec 15, 2026. Winners are announced Dec 21; don't edit the repo or video after the deadline until then.
- Sandbox facts that shape the build:
  - PayPal's hosted sandbox MCP server (mcp.sandbox.paypal.com) has returned "Unsupported cache mode: default" on every tool call since Oct 29 (forum report). GitHub issue paypal/agent-toolkit#119 is still open. Don't depend on it. Run @paypal/agent-toolkit in Node with your own sandbox credentials.
  - The Agent Toolkit has no authorize, capture or void tools. Call Payments v2 REST for those.
  - PayPal wallet vaulting is refused for platform apps in sandbox (forum: NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE). Authorize plus later capture works.
  - Authorizations: 3-day honor period, valid 29 days, reauthorize allowed inside the 29 days. Multiple partial captures need the feature enabled on the account; final_capture true closes the authorization.
- What the crowd will build (straight from the Resources page inspiration list): a shopping agent with a PayPal button, a receipt-scanning bill splitter, a freelancer invoice nudger, a budgeting dashboard, a donation page. Permission Slip is the layer every one of those agents would plug into.

## 3. Ideas, scored

Nine ideas, five scores each, totals out of 25.

| Idea | What it does | Lens | Feas | Impact | Novelty | Demo | Scope | Total | Prize lane |
|---|---|---|---|---|---|---|---|---|---|
| 1. Permission Slip | Plain-words mandate, PayPal-held budget, injection-proof guard, refund on breach | Synthesis | 4 | 5 | 5 | 5 | 4 | 23 | Grand, Agentic Commerce, Channel3 |
| 2. Second Look | Reads the chat before you pay a stranger, names scam tactics, swaps a Friends and Family send for a protected checkout | Prediction | 4 | 5 | 4 | 5 | 4 | 22 | Most Impactful |
| 3. Bounty Board | Neighbors pool money for a job, vision AI checks before/after photos, PayPal Payouts pays the worker on pass | Automation | 4 | 4 | 3 | 5 | 4 | 20 | Most Creative, Render |
| 4. Talk to Pay | Voice shopping and payment agent for blind and low-vision users | Accessibility | 3 | 4 | 3 | 5 | 3 | 18 | Most Impactful |
| 5. Upstream | Reads your dependency tree and splits a monthly budget to maintainers via Payouts | Personalization | 4 | 3 | 2 | 4 | 5 | 18 | none strong |
| 6. Hire Wire | Agents hire specialist agents; PayPal authorize on start, capture on accepted work | Synthesis | 3 | 3 | 4 | 4 | 3 | 17 | Agentic Commerce |
| 7. Toll Road | AI crawlers pay creators per fetch, metered and settled on PayPal | Data access | 3 | 4 | 4 | 3 | 3 | 17 | Most Creative |
| 8. Dispute Desk | Small-merchant copilot that gathers evidence and answers PayPal disputes | Automation | 4 | 4 | 2 | 3 | 4 | 17 | Bryntum |
| 9. Cash Weather | Freelancer cash-flow forecast plus tone-matched invoice nudges | Prediction | 5 | 3 | 1 | 3 | 5 | 17 | AG Grid |

Why the low-novelty ones dropped:

- Upstream: thanks.dev already funds dependency trees, and StackAid did too.
- Dispute Desk: Chargeflow raised a $35M Series A, and Justt raised $30M in Dec 2024.
- Cash Weather: AG Grid's own sponsor page lists a nudge-bot.
- Toll Road: Cloudflare Pay per crawl and Coinbase's x402 own that story. No PayPal involvement found.
- Hire Wire: the impact is hard to prove in 3 minutes.

## 4. Top 3 concept cards

### Concept 1: Permission Slip

- One-liner: a permission slip for your AI. You write what your agent may buy in plain words. PayPal holds exactly that much money. A separate guard, one the agent can't talk to, checks every cart against your words before a cent moves. Whatever isn't spent goes back to you.
- Problem: see section 1.
- Solution flow:
  1. Write. "Birthday gift for my nephew Leo, turning 6, loves dinosaurs. Under $60. Has to arrive by Saturday. Nothing that needs batteries."
  2. Compile. An LLM turns it into numbered clauses on a slip card: budget $60, quantity 1, category toy/gift, deliver by Sat, exclusion "no batteries", expires in 72 hours (matches PayPal's 3-day honor period). The user edits any clause.
  3. Sign with PayPal. Orders v2 with intent AUTHORIZE for $60; the buyer approves with the PayPal JS SDK v6 button; the server calls authorize. A real hold now sits at PayPal, outside the agent's reach.
  4. Shop. The agent searches Channel3 (100M+ products, 25,000+ retailers) and proposes a cart.
  5. Guard. A quarantined extractor model turns each listing into a fixed schema (price, in stock, delivery estimate, power source, item count) and can't call any tool. Deterministic TypeScript checks compare that schema with the clauses. The result is a stamp: WITHIN SLIP, or OUTSIDE SLIP citing the clause number. Unknown fields fail closed and ask the user.
  6. Pay and release. On pass, capture the cart total against the authorization (final_capture true). The unspent remainder is released (confirm in Sunday's curl test; call void if the hold lingers). The ledger shows Held $60.00, Spent $42.18, Released $17.82 (demo numbers).
  7. After delivery. The user snaps a photo. A vision model compares it to the slip and the listing. On breach, the app builds an evidence pack (slip, agent trace, guard verdict, photo) and issues a refund through the Agent Toolkit's create_refund. Webhooks update the ledger.
- AI/ML core: LLM structured output (mandate compiler), LLM tool use (shopping agent), quarantined extraction plus deterministic policy (the guard; the dual-LLM pattern from prompt-injection research), vision (delivery check). Models: claude-sonnet-5-5 for compiler, agent and vision; claude-haiku-5-5 for the extractor.
- Target user: anyone who lets an AI buy for them. Demo persona: a parent sorting out a nephew's birthday between meetings. Second audience: PayPal, as the shopper-side partner to Agent Ready.
- Competitive advantage: Google's AP2 (Sept 2025, PayPal a launch partner) defines intent and cart mandates as a protocol. Visa Intelligent Commerce and Mastercard Agent Pay put limits in network tokens that issuers control. Payman and Skyfire are developer tools. Stripe's Shared Payment Token scopes one seller and a max amount inside ChatGPT checkout. Permission Slip is a consumer product on PayPal rails: the user reads the mandate in plain words, the cap is a real PayPal authorization, and the guard never reads text the agent can be fed.
- Technical approach:
  - Data: Channel3 POST https://api.trychannel3.com/v1/search with filters for price and availability, config mode "agentic". Offers carry price, availability and buy URL. Promo code PAYPAL-HACKATHON-2026 gives 20,000 free credits.
  - Model: as above.
  - Integration: Payments v2 REST for authorize, capture, void, reauthorize. @paypal/agent-toolkit for create_refund, get_order, create_shipment_tracking, list_transactions. Webhooks PAYMENT.AUTHORIZATION.CREATED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.AUTHORIZATION.VOIDED and PAYMENT.CAPTURE.REFUNDED drive the ledger.
- MVP scope:
  - [ ] Slip compiler plus PayPal-signed hold
  - [ ] Channel3 shopping agent
  - [ ] Guard with a red-team listing
  - [ ] Capture and release ledger on webhooks
  - [ ] Delivery photo check plus refund
- Out of scope: checkout at real retailers (in sandbox the app is merchant of record; in production the payee is an Agent Ready merchant), multi-merchant slips, long-lived vaulted mandates (vault refused in sandbox), family co-signers, mobile app.
- Demo flow: shot list in section 8.
- Risks:
  - Technical: multiple partial captures need an account flag, so design one capture per slip and treat multi-capture as a bonus. Vision false positives: the user confirms before any refund.
  - Data: Channel3 may lack delivery estimates, so unknown means fail closed and ask.
  - Adoption: one extra step before shopping. The slip takes about 10 seconds, and the PayPal approval screen is one people already know.

### Concept 2: Second Look

- One-liner: before you pay a stranger, Second Look reads the chat, names the scam tactics it sees, and turns a risky Friends and Family send into a protected PayPal checkout.
- Problem: the FTC reports $15.9B in fraud losses for 2025, up from about $12.5B in 2024. FBI IC3 2025: adults 60 and older lost about $7.7B. PayPal's help pages list Friends and Family payments as not eligible for Purchase Protection, and "send it as friends and family to skip the fee" is a stock scam line.
- Solution: paste a chat screenshot and the listing. Vision plus an LLM tag the tactics (Friends and Family request, urgency, moving off-platform, price too good, ship-only, overpayment) and write a plain-words risk card. One tap creates a PayPal order to the seller's email (purchase_units payee.email_address) as a goods payment. The honest-offer test: honest sellers take a protected payment, and refusal is the tell. Shipment tracking attaches via the Agent Toolkit. The sandbox disputes path (POST /v1/customer/disputes, then provide-evidence) shows the evidence pack in action. Family mode alerts a trusted contact.
- Target user: marketplace buyers, older adults and their adult kids.
- Competitive advantage: bank warnings tell you to be careful; Second Look gives you a safe way to still buy the thing.
- Risks: payee email to a personal sandbox account is unconfirmed (test on day 1; fallback is a sandbox business seller). There's no labeled scam dataset (curate about 30 scripts from FTC examples). People in a hurry skip warnings (meet them at the moment of paying, via the share sheet).

### Concept 3: Bounty Board

- One-liner: neighbors pool money for a job (clear a storm drain, shovel a senior's walk). Anyone can claim it. A vision model checks the before and after photos. PayPal Payouts pays the worker the moment it passes.
- Problem: small paid community jobs stall on trust. Backers can't verify the work, and workers wait to get paid. Prior art is small hackathon projects (e.g. GigSmartPay on Devpost); no established product.
- Solution: backers fund via Orders. A worker claims the job, then uses in-app live capture of before and after shots with timestamp and location. A vision rubric plus a duplicate-image hash check verifies the work. Payouts pays the worker, and backers get receipts. Render Workflows can run the verification jobs (Render sponsor lane).
- Risks: faked photos (live capture only, location and time checks). Payouts sandbox limits are unconfirmed (test day 1). Payouts need the worker's PayPal email.

## 5. Why Permission Slip wins, criterion by criterion

| Criterion | What the judges see |
|---|---|
| Technological Implementation | Real authorize, capture and release on PayPal REST; Agent Toolkit for refunds, tracking and lookups; webhooks drive the UI; a two-model guard; `npm run redteam` prints block and allow rates in the README. |
| Design | One metaphor, end to end: the slip, the PayPal signature, the stamp, the ledger (held, spent, released). |
| Potential Impact | Trust is the gate (23% / 9% / two-thirds want control). The money is large (up to $1T US by 2030; $262B influenced last holiday season). |
| Innovation | The shopper-side counterpart to PayPal's merchant-side Agent Ready. AP2-style mandates a person can read, enforced by a PayPal hold the agent can't touch. |
| Presentation | A villain everyone gets ($31.43 eggs, a hijacked listing), a hero moment (the red stamp), a happy ending (money coming back). |

The headline we want: "Hackathon team gives AI shopping agents a permission slip, built on PayPal."

## 6. MVP spec: Permission Slip

- Core value proposition: your agent can't spend a cent beyond what you wrote down, and you can prove what it did.
- User story: As someone who lets an AI shop for me, I want to write what it may buy in plain words and have PayPal hold only that much, so my agent can't overspend, can't be talked into the wrong item, and leaves me a clean refund path.
- Features, ranked:
  1. [Must] Slip compiler plus PayPal-signed hold.
  2. [Must] Channel3 shopping agent.
  3. [Must] Guard plus red-team listing (the demo's hero moment).
  4. [Must] Capture and release ledger on webhooks.
  5. [Should] Delivery photo check and refund with evidence pack.
  6. [Could] Sandbox dispute path, only if time.
- Red-team suite: 20 hostile listings (injected instructions in descriptions, bundle swaps, price changes after search, battery-powered variants, late delivery) and 20 clean ones. The README reports the real counts the team gets. Don't promise numbers in advance.

| Component | Choice | Why |
|---|---|---|
| Language | TypeScript end to end | PayPal JS SDK v6 and @paypal/agent-toolkit are both JS/TS |
| AI | Anthropic API: claude-sonnet-5-5, claude-haiku-5-5 | Tool use, structured output and vision in one provider; Haiku keeps the extractor cheap |
| App | Next.js (App Router) with route handlers | One deploy for UI, API and webhook receiver |
| Payments | Payments v2 REST plus @paypal/agent-toolkit in Node | Toolkit lacks authorize/capture/void; the hosted sandbox MCP is down (issue #119) |
| Products | Channel3 search API | Clean offers with price, availability, buy URL; sponsor prize |
| Data | SQLite on a Render persistent disk | Slips, verdicts, ledger events; survives restarts |
| Hosting | Render paid starter instance, $50 hackathon credits | Free instances spin down and judges hit a cold start; must stay up to Dec 15 |

Definition of demo-ready:

- [ ] Hosted URL works in an incognito window using the sandbox buyer login from the testing instructions
- [ ] README run steps tested on a clean clone
- [ ] No secrets in the repo (env vars only)
- [ ] Open source license visible in the repo's About section
- [ ] Video under 3:00, public on YouTube
- [ ] Every service, key and credit stays live until Dec 15

## 7. Build plan to Nov 12, 12:00pm PST

| When | Milestone |
|---|---|
| Sun Nov 8, evening (2h) | Sandbox REST app; test authorize, capture (final_capture true), void and refund with curl; check if multiple partial captures are enabled; Channel3 key with promo code; repo with LICENSE; hello-world deploy on Render. |
| Mon Nov 9 | Slip compiler with JSON schema; slip card UI; PayPal sign button; authorize; webhook receiver; ledger. |
| Tue Nov 10 | Channel3 agent loop; quarantined extractor; deterministic guard; red-team listing; capture and release. |
| Wed Nov 11, morning | Delivery photo check; refund via Agent Toolkit; `npm run redteam`; README with results. |
| Wed Nov 11, afternoon/evening | UI polish; record demo; edit; upload to YouTube that night (processing can take hours). |
| Thu Nov 12, by 10:00am PST | Devpost form: name PayPal and AI in the description, Built With and video; select Channel3 as a sponsor tool; testing instructions with sandbox buyer login; submit by 11:00am. Hard deadline 12:00pm PST. |

Cut list if behind: drop item 5 first, then the ledger animation. Never cut the guard or the real PayPal hold.

## 8. Video script (2:55)

| Time | On screen | Voiceover (AI voiceover is allowed by the organizers) |
|---|---|---|
| 0:00 to 0:15 | Text card citing The Washington Post, Feb 2025 (text only, no logo) | "A columnist asked an AI agent to find cheap eggs. It bought them, for $31.43. He never said yes." |
| 0:15 to 0:35 | Stats (23%, 9%) then title card | Agents are starting to shop for us. Only 23% of US adults would trust AI to make a payment. Today the only rule is a sentence in a prompt any page can rewrite. "This is Permission Slip." |
| 0:35 to 1:00 | Typing the slip; clauses appear; PayPal sign; "Held $60.00" | Plain words in, numbered clauses out, signed with PayPal, a real hold. |
| 1:00 to 1:45 | Agent shopping live; planted listing with hidden instruction pushes a 4-pack and a $200 gift card; red OUTSIDE SLIP stamp on clause 2; agent re-plans; WITHIN SLIP; capture; "Released $17.82" | The guard never reads what the agent reads. |
| 1:45 to 2:15 | Delivery photo shows a toy with a battery pack; clause 5 breach; evidence pack; refund lands via webhook | The refund path. |
| 2:15 to 2:40 | Architecture diagram: user, slip, PayPal hold, agent, quarantined extractor, guard, Channel3; red-team results from README | Even a fully hijacked agent can't spend past the slip, because the ceiling lives at PayPal. |
| 2:40 to 2:55 | Closing card | "PayPal made it safe to pay strangers on the internet. The newest stranger holding your money is your own AI. Permission Slip makes it safe to let it shop." |

Note: blur retailer logos and brand images from Channel3 results in the video. The rules bar third-party trademarks without permission, and the organizers haven't answered the forum question about brand names on screen.

## 9. 60-second pitch

- Hook (10s): "A columnist asked an AI agent to find cheap eggs. It bought them, for $31.43. He never said yes."
- Problem (15s): agents are starting to shop for us. Only 23% of US adults would trust AI to make a payment. Today the only rule is a sentence in a prompt, and any page the agent reads can rewrite it.
- Solution (20s): the one-liner from The call, word for word.
- Demo moment: the red stamp on the hijacked dinosaur listing.
- Impact (10s): "PayPal made it safe to pay strangers on the internet. The newest stranger holding your money is your own AI."
- Ask (5s): "Try it with the sandbox login in our README, and tell us which clause you'd add first."

## 10. Submission checklist

From the official rules and updates.

- [ ] PayPal and AI both visible in the description, Built With and video
- [ ] Hosted demo URL plus run instructions
- [ ] Public repo on GitHub with README and open source license in About
- [ ] Public YouTube video under 3 minutes showing it working
- [ ] Sponsor tool (Channel3) selected on the form
- [ ] Teammates invited through the Devpost project and accepted
- [ ] Test credentials in the testing instructions, never in the repo
- [ ] All materials in English
- [ ] Everything running until Dec 15
- [ ] No edits to repo or video after the deadline until winners are announced Dec 21
- [ ] Every team member eligible (Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and OFAC-sanctioned places are excluded)

## 11. Sources

Items marked (verify) came from search summaries. Click through before they go on a slide.

- Operator eggs: https://www.adn.com/alaska-life/2025/02/09/i-let-chatgpts-new-agent-manage-my-life-it-spent-31-on-a-dozen-eggs/ (Washington Post reprint, Feb 9, 2025)
- Brave on Comet (verify): https://brave.com/blog/comet-prompt-injection/ ; follow-up https://brave.com/blog/unseeable-prompt-injections/
- Magentic Marketplace (verify): https://www.microsoft.com/en-us/research/wp-content/uploads/2025/10/multi-agent-marketplace.pdf
- Visa Trust Index 23% (verify): https://www.crowdfundinsider.com/2026/09/308695-visa-research-consumer-trust-is-enabling-path-to-agentic-commerce/
- Accenture 2026 Consumer Pulse (verify): https://www.artificialintelligence-news.com/news/ai-shopping-agents-consumer-trust-accenture-report/
- Commerce and PayPal study (verify): https://commerce.gcs-web.com/news-releases/news-release-details/two-thirds-consumers-are-ready-try-agentic-shopping-many-demand
- McKinsey: https://www.mckinsey.com/industries/retail/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants
- Salesforce holiday 2025: https://www.salesforce.com/news/press-releases/2026/01/06/2025-holiday-shopping-data/
- PayPal Agent Ready and Store Sync: https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping
- FTC 2025 losses: https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-testifies-joint-economic-committee-agencys-efforts-combat-fraud
- FBI IC3 elder losses via AARP: https://www.aarp.org/money/scams-fraud/fbi-ftc-report-2025-losses
- PayPal Purchase Protection exclusions (verify): https://www.paypal.com/us/webapps/mpp/ua/buyer-protection
- PayPal authorization periods: https://developer.paypal.com/docs/checkout/standard/customize/authorization/
- Pay another account (payee email): https://developer.paypal.com/docs/checkout/standard/customize/pay-another-account
- Disputes sandbox testing: https://developer.paypal.com/disputes/test-go-live
- Agent Toolkit tools: https://github.com/paypal/agent-toolkit ; hosted MCP bug: https://github.com/paypal/agent-toolkit/issues/119
- Channel3 search API: https://channel3.mintlify.dev/docs/api-reference/v1/search.md
- AP2 (verify): https://www.digitalcommerce360.com/2025/09/19/google-ai-payments-protocol-ap2/
- Chargeflow (verify): https://www.pymnts.com/?p=3242160 ; Justt (verify): https://thepaypers.com/fraud-and-fincrime/news/justt-upgrades-ai-chargeback-management
- Hackathon pages: https://paypalaihackathon.devpost.com/ , /rules , /resources , /updates
