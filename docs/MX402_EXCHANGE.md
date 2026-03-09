# MX402 Exchange

## Status
- Working concept brief
- Source of truth for future planning and build decisions
- Based on prior discussion around a MultiversX-native `x402` pay-per-API marketplace
- Concrete engineering architecture: `docs/MX402_ARCHITECTURE.md`
- V1 implementation spec: `docs/MX402_V1_SPEC.md`

## Working One-Liner
MX402 Exchange is a MultiversX-native pay-per-API marketplace that lets API providers monetize endpoints per request and lets apps, agents, and developers pay programmatically with on-chain settlement rails instead of subscriptions or credit-card-based billing.

## Problem
API monetization is still built around monthly subscriptions, API keys, invoices, and off-chain billing systems that do not fit agents, bots, or granular machine-to-machine usage.

This creates several gaps:
- Small or experimental users overpay for fixed plans
- API providers face billing overhead, fraud risk, and weak global monetization rails
- Agents and autonomous software cannot reliably buy API access on demand
- Usage verification and settlement are fragmented across gateways and internal ledgers

## Proposed Solution
MX402 Exchange provides a marketplace and payment gateway where:
- Providers list APIs with transparent per-call or per-unit pricing
- Buyers fund usage with MultiversX-native payment flows
- Requests are metered in real time
- Access is authorized only when payment or prepaid credit is valid
- Usage receipts are recorded for reconciliation, analytics, and provider settlement

The goal is to make API commerce feel native to the internet and native to MultiversX.

## Core Users
- API providers that want usage-based monetization
- AI agents and agent platforms that need machine-payable APIs
- Developers building apps that consume third-party APIs
- Data vendors and infra operators monetizing premium endpoints

## Why MultiversX
- Fast and relatively low-cost transactions support granular settlement flows
- Strong builder tooling can support wallet-connected developer experiences
- The project can drive real utility through repeated API-related transactions
- The concept is ecosystem-expanding: infra, payments, AI, and developer tooling all intersect here

## Product Scope
### Provider Side
- Create provider profile
- Register API products and endpoint metadata
- Set pricing model per endpoint or usage tier
- Generate gateway credentials and signing rules
- Track usage, revenue, and settlement history

### Consumer Side
- Browse listed APIs
- Fund prepaid balance or authorize payment flow
- Obtain request authorization token
- Make metered API calls
- View usage receipts, spend history, and active integrations

### Platform Side
- Usage metering
- Request authorization
- Settlement and payout logic
- Rate limiting and abuse protection
- Usage analytics and audit trails

## MVP Definition
The MVP should prove that a provider can list an API, a buyer can fund access, and metered requests can be authorized and reconciled end to end.

### MVP Deliverables
- Provider onboarding dashboard
- Consumer dashboard
- API registry and listing pages
- Metering and authorization gateway
- MultiversX payment and settlement flow
- SDK or integration examples for providers and consumers
- Basic analytics for calls, spend, and payouts

## Technical Architecture
### 1. Frontend
- Provider console for API listing and revenue tracking
- Consumer dashboard for discovery, balances, usage, and receipts
- Public marketplace UI for API discovery

### 2. Backend Services
- API registry service for providers, products, pricing, and metadata
- Metering service for counting requests and usage units
- Authorization service that validates active balance, quota, or signed payment intent
- Settlement service that records payable usage and payout state
- Analytics service for usage, revenue, and provider performance

### 3. MultiversX Integration Layer
- Wallet connection and transaction initiation
- Prepaid balance or escrow-style payment model
- Settlement records tied to usage batches or individual authorizations
- Optional on-chain proofs or signed receipts for verifiability

### 4. Smart Contract Layer
- Provider registration and payout configuration
- Buyer balance or deposit tracking
- Settlement rules for provider payouts and platform fees
- Emergency withdrawal, pause, and admin controls

### 5. Developer Tooling
- Client SDK for request signing and auth handling
- Provider integration middleware or example proxy
- Example agent integration for machine-to-machine payments

## Suggested Transaction Model
The most practical MVP model is prepaid credit plus off-chain metering with periodic on-chain settlement.

Why this is the likely starting point:
- It avoids forcing an on-chain transaction for every single API call
- It reduces latency for live API usage
- It still preserves a clear MultiversX-native payment rail
- It is easier to ship than a fully trustless per-request settlement design

## High-Level Request Flow
1. Provider registers API and pricing terms.
2. Consumer funds a balance or deposit.
3. Consumer requests an auth token for a specific API product.
4. Gateway validates balance and issues scoped access.
5. Consumer sends requests through the metering layer.
6. Usage is logged and attributed.
7. Settlement service batches usage and updates provider payout state.
8. Consumer and provider can inspect receipts and balances in the dashboard.

## Revenue Model
- Platform take rate on API sales
- Optional premium provider tooling and analytics
- Enterprise gateway plans for higher-volume providers
- Potential white-label infrastructure for partner ecosystems

## Ecosystem Impact
- Introduces a real machine-payments use case on MultiversX
- Increases developer relevance of the ecosystem beyond token speculation
- Creates recurring utility transactions linked to real software usage
- Helps position MultiversX for AI agent and API economy workflows

## Milestones
### Milestone 1: Research and Protocol Design
- Finalize payment model
- Validate MultiversX integration assumptions
- Define provider and consumer flows
- Produce system architecture and product spec

### Milestone 2: MVP Build
- Build registry, dashboard, and gateway services
- Implement payment and settlement contract
- Ship SDK and integration examples
- Run closed alpha with test providers

### Milestone 3: Pilot Launch
- Onboard initial providers
- Launch public marketplace beta
- Measure usage, conversion, and settlement behavior
- Tighten abuse controls and analytics

## MVP Build Plan
### Step 1: Freeze MVP Rules
- Confirm first users: crypto-native API providers and developer buyers
- Confirm one supported payment asset
- Confirm pricing model: fixed per-call pricing only
- Confirm payment flow: prepaid balance, off-chain metering, batched settlement
- Confirm pilot scope: curated provider onboarding

### Step 2: Write Product Spec
- Define provider journey from signup to first paid API call
- Define buyer journey from deposit to first successful request
- Define admin journey for provider approval and payout review
- Define exact states for balances, usage records, and payouts

### Step 3: Design Smart Contract Layer
- Contract for buyer deposits and withdrawable balances
- Provider payout configuration
- Platform fee handling
- Batched settlement execution
- Pause and emergency withdrawal controls

### Step 4: Define Data Model
- Providers
- API products
- Pricing rules
- Buyer accounts
- Balances
- Access tokens
- Usage records
- Settlement batches
- Payout records

### Step 5: Build Backend Foundation
- Authentication and account management
- API registry service
- Balance and ledger service
- Settlement service
- Admin service for provider approvals and payout operations

### Step 6: Build Metering Gateway
- Issue scoped API access credentials
- Proxy or verify API requests
- Count requests in real time
- Enforce rate limits
- Reject calls when balance is insufficient
- Persist usage receipts

### Step 7: Integrate MultiversX Payments
- Wallet connect flow
- Deposit transaction flow
- Contract event indexing or balance sync
- Withdrawal flow
- Batch payout execution for providers

### Step 8: Build Frontend MVP
- Public marketplace page
- Provider dashboard
- Buyer dashboard
- Deposit and withdrawal screens
- Usage and receipt history
- Provider earnings and payout views

### Step 9: Ship SDK and Examples
- Consumer SDK for auth and request handling
- Provider example integration for metering and header validation
- End-to-end sample app showing paid API usage

### Step 10: Add Safety Controls
- Signed request or scoped token validation
- Replay protection
- Abuse and spam controls
- Audit logs for settlement and payout actions
- Basic monitoring and alerting

### Step 11: Test End to End
- Contract tests
- Backend integration tests
- Gateway load and failure tests
- Deposit, usage, settlement, and withdrawal scenario tests
- Pilot dry runs with seeded balances and sample APIs

### Step 12: Run Closed Pilot
- Onboard 3 to 5 providers
- List 5 to 10 APIs
- Run real buyer usage
- Validate unit economics, latency, and settlement correctness
- Collect friction points before public beta

## KPI Targets
- 5 to 10 APIs listed in pilot
- 3 to 5 active providers
- 100+ developer signups in early beta
- 10,000+ metered API calls in pilot period
- 1,000+ MultiversX-linked payment or settlement transactions, depending on settlement cadence

## Budget Baseline
Prior working budget assumption: `USD 50,000`

Intended coverage:
- Product and backend engineering
- Smart contract development
- Frontend dashboard work
- Security review
- Pilot onboarding and growth support

## Risks
- Per-request on-chain settlement may be too slow or costly for real API traffic
- Abuse resistance and fraud prevention are non-trivial
- Provider onboarding may stall if integration friction is high
- Buyers may prefer centralized billing until UX is significantly simpler
- Regulatory and payments framing must remain clear

## Mitigation Direction
- Start with prepaid balances and batched settlement
- Keep provider integration thin
- Add strict metering, signed receipts, and replay protection
- Pilot with a small number of curated providers before broad launch

## Open Questions
- Should the primary unit be per-request, per-second, or per-compute-unit pricing?
- Should settlement be batch-based, streaming, or escrow-release based?
- Should platform fees be flat, percentage-based, or tiered?
- Which token or payment asset should the MVP use?
- How much usage data belongs on-chain versus off-chain?
- Is the first wedge AI agents, general developers, or data providers?
- Should the initial product be a marketplace, a gateway, or both?

## Current Assumptions To Carry Forward
- The idea started from the `x402 Pay-Per-API Marketplace` concept
- The MultiversX adaptation is currently named `MX402 Exchange`
- The first target should be a technically practical MVP, not a fully trustless design
- The first architecture pass should optimize for low latency, easy provider onboarding, and clear settlement

## Official MultiversX Stack To Use
The following choices are aligned with the official MultiversX builder resources and documentation.

### Frontend and Wallets
- Use `sdk-dapp` for wallet login, transaction signing, account state, and transaction tracking
- Prefer official signing providers through `sdk-dapp` rather than custom wallet integrations
- Use wallet-based login plus Native Auth for authenticated backend sessions

### Backend and On-Chain Integration
- Use `sdk-js` and `sdk-core` for transaction building, contract interaction, and network operations
- Use `sdk-native-auth-server` or the official NestJS auth utilities if the backend is built with NestJS
- Use the public MultiversX API for indexed blockchain data and the Gateway for lower-level transaction and query operations

### Smart Contracts
- Build contracts in Rust using the official MultiversX smart contract framework
- Keep the contract scope narrow: deposits, withdrawals, provider payout config, fees, and batched settlement
- Use reproducible build guidance before any production deployment

### Testing and Local Development
- Use `mxpy` for contract workflows and scripting where useful
- Use Chain Simulator for fast local contract and integration testing
- Use Rust interactors for system-style contract interaction tests if needed

## Official References
- Builder resource library: https://multiversx.com/builders/builder-tools-resources
- Docs home: https://docs.multiversx.com/
- SDK and tools overview: https://docs.multiversx.com/sdk-and-tools/overview/
- `sdk-dapp`: https://docs.multiversx.com/sdk-and-tools/sdk-dapp/
- `sdk-js`: https://docs.multiversx.com/sdk-and-tools/sdk-js/
- NestJS auth utilities: https://docs.multiversx.com/sdk-and-tools/sdk-nestjs/sdk-nestjs-auth/
- Chain simulator: https://docs.multiversx.com/sdk-and-tools/chain-simulator/
- MultiversX API: https://docs.multiversx.com/sdk-and-tools/rest-api/multiversx-api/
- Transactions API: https://docs.multiversx.com/sdk-and-tools/rest-api/transactions/
- Smart contracts overview: https://docs.multiversx.com/developers/smart-contracts/
- Interactors overview: https://docs.multiversx.com/developers/meta/interactor/interactors-overview/
- Reproducible contract builds: https://docs.multiversx.com/developers/reproducible-contract-builds/
- Wallet webhooks: https://docs.multiversx.com/wallet/webhooks

## Next Best Step
Turn this concept brief into a product requirements document with:
- narrowed MVP scope
- chosen payment model
- user journeys
- contract responsibilities
- API schemas
- delivery plan
