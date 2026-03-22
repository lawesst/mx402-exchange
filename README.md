# MX402 Exchange

MX402 Exchange is a MultiversX-native pay-per-API marketplace. It lets API publishers monetize endpoints with on-chain EGLD settlement, while consumers pay only for what they use.

This repository is the working MVP codebase for the product.

## Project Summary

Most APIs are sold through subscriptions, credit cards, and centralized billing. That model creates friction for:

- builders with bursty or low-volume usage
- on-chain applications and agents that need machine-payable access
- global developers who want programmable settlement instead of recurring SaaS plans

MX402 Exchange introduces a different model:

- publishers list APIs with fixed per-call pricing
- buyers fund a MultiversX balance in EGLD
- requests are metered through a gateway
- usage is settled on-chain in batches through a MultiversX smart contract

The result is a practical pay-per-call marketplace with blockchain-native settlement and developer-friendly consumption flows.

## Why MultiversX

MX402 is designed around MultiversX as the value and settlement layer:

- EGLD is used for funding and settlement
- wallet-native login and transaction signing are built into the user flow
- provider earnings are claimable on-chain
- settlement batches are verifiable through the MultiversX Devnet explorer

This makes the product more than a generic API catalog with crypto branding. The payment and settlement mechanics are part of the product core.

## What Is Live Today

Public app:

- [https://mx402-exchange.vercel.app](https://mx402-exchange.vercel.app)

Live public surfaces:

- marketplace UI
- provider publish flow
- admin moderation flow
- buyer dashboard and wallet screens
- hosted API proxy
- hosted gateway proxy
- hosted worker trigger

Useful live endpoints:

- Products: [https://mx402-exchange.vercel.app/__mx402_api/v1/products](https://mx402-exchange.vercel.app/__mx402_api/v1/products)
- Gateway health: [https://mx402-exchange.vercel.app/__mx402_gateway/health](https://mx402-exchange.vercel.app/__mx402_gateway/health)

## Current MVP Scope

The current MVP includes:

- provider profile creation and product publishing
- admin approval and product activation
- buyer wallet-backed authentication
- deposit preparation and deposit indexing
- project creation, API key issuance, and access grants
- paid API execution through a metering gateway
- usage receipts
- batched on-chain settlement
- provider earnings tracking and claim flow

The current implementation uses:

- on-chain payment and settlement on MultiversX
- off-chain request metering and usage accounting
- batched settlement for practical throughput

## Proof of Validation

### 1. Separate-wallet Devnet Validation

MX402 has already been validated on MultiversX Devnet with separate owner, provider, and buyer wallets.

Validated flow:

1. Provider created and approved
2. Product created, submitted, and activated
3. Buyer deposited EGLD
4. Buyer executed a paid call
5. Usage was settled on-chain
6. Provider claimed earnings on-chain

Detailed run report:

- [`docs/runs/devnet-validation-2026-03-16.md`](docs/runs/devnet-validation-2026-03-16.md)

Ledger contract used in devnet validation:

- `erd1qqqqqqqqqqqqqpgqe00lpfaeprevlmj2fj2eezygrp7ljy2dtqsqndmsz6`

### 2. Public Hosted Buyer Flow Validation

A full buyer flow was also executed against the public Vercel deployment.

Hosted flow covered:

1. public Native Auth login
2. public deposit preparation
3. real EGLD deposit on Devnet
4. hosted deposit tracking
5. hosted worker sync
6. buyer project creation
7. API key creation
8. product grant
9. paid gateway call
10. receipt retrieval

Public hosted buyer flow artifacts:

- Buyer deposit tx: [717638f50809d08db89e0860a37904ce501ac634d7e4210f56bfb26d2ae8f14c](https://devnet-explorer.multiversx.com/transactions/717638f50809d08db89e0860a37904ce501ac634d7e4210f56bfb26d2ae8f14c)
- Receipt id: `rcpt_5f15ac01d9be3089170b`
- Product used: `xexchange-price-feed`
- Charged amount: `0.0001 EGLD`

That receipt was then settled on Devnet in a confirmed batch:

- Batch id: `mx402-20260322124714-ccca545e`
- Settlement tx: [2969b162a9c08d70bffe94e724a0c4a7c2496aa50a49eff04c65b1d675141afe](https://devnet-explorer.multiversx.com/transactions/2969b162a9c08d70bffe94e724a0c4a7c2496aa50a49eff04c65b1d675141afe)

## Architecture

MX402 is organized as a monorepo with a clear separation between user-facing product flows, gateway execution, and on-chain settlement.

### Apps

- `apps/web`  
  Next.js frontend for marketplace browsing, publish flow, admin flow, wallet, analytics, and dashboards

- `apps/api`  
  Core marketplace API for authentication, providers, products, projects, balances, usage, and admin operations

- `apps/gateway`  
  Paid-call execution layer that authenticates API keys, meters usage, forwards requests upstream, and issues receipts

- `apps/worker`  
  Background settlement runtime for deposit sync, settlement batch submission, and provider claim confirmation

### Contracts

- `contracts/mx402-ledger`  
  MultiversX smart contract handling deposits, batched settlement accounting, and provider claims

### Shared Packages

- `packages/config`
- `packages/db`
- `packages/domain`
- `packages/multiversx`
- `packages/observability`

## Technology Stack

- Next.js 14
- TypeScript
- Fastify
- Prisma
- PostgreSQL
- MultiversX SDKs
- MultiversX Rust smart contracts
- Vercel for frontend and hosted runtime entry points
- Neon for managed database infrastructure

## Product Flow

### Publisher Flow

1. Create provider profile
2. Create product draft
3. Configure endpoint, pricing, and auth
4. Submit for review
5. Admin approves and activates product
6. Product becomes callable through MX402

### Buyer Flow

1. Connect wallet and authenticate
2. Deposit EGLD
3. Create a buyer project
4. Generate an API key
5. Grant a product to the project
6. Make a paid API call
7. Receive a usage receipt

### Settlement Flow

1. Charged usage events accumulate off-chain
2. Worker prepares a settlement batch
3. Batch is submitted on-chain
4. Batch confirmation updates platform state
5. Provider claims earnings from the contract

## Repository References

Core design and implementation references:

- [`docs/MX402_EXCHANGE.md`](docs/MX402_EXCHANGE.md)
- [`docs/MX402_ARCHITECTURE.md`](docs/MX402_ARCHITECTURE.md)
- [`docs/MX402_V1_SPEC.md`](docs/MX402_V1_SPEC.md)

Validation reference:

- [`docs/runs/devnet-validation-2026-03-16.md`](docs/runs/devnet-validation-2026-03-16.md)

## Local Development

### Workspace Layout

- `apps/api`
- `apps/gateway`
- `apps/worker`
- `apps/web`
- `contracts/mx402-ledger`
- `packages/*`

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Run Locally

```bash
npm run dev:api
npm run dev:gateway
npm run dev:worker
npm run dev:web
```

### Database

Push the Prisma schema:

```bash
npm run db:push
```

## Environment Notes

Node services auto-load `.env` and `.env.local` by walking upward from the current working directory.

Browser login and wallet flows should use public MultiversX endpoints:

- `NEXT_PUBLIC_MULTIVERSX_API_URL`
- `NEXT_PUBLIC_MULTIVERSX_WALLET_URL`
- `NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL`

Server-side chain reads can use dedicated endpoints:

- `MULTIVERSX_CHAIN_API_URL`
- `MULTIVERSX_CHAIN_GATEWAY_URL`
- `MULTIVERSX_CHAIN_API_KEY`
- `MULTIVERSX_CHAIN_EVENTS_URL`

Required environment for products using static upstream auth:

- `MX402_PROVIDER_SECRET_ENCRYPTION_KEY`

## Devnet Execution

Deploy the ledger contract:

```bash
npm run deploy:devnet:ledger
```

Run the full devnet scenario:

```bash
npm run scenario:devnet:real
```

Typical required variables for a real devnet run:

- `MX402_OWNER_PRIVATE_KEY`
- `MX402_PROVIDER_PRIVATE_KEY`
- `MX402_BUYER_PRIVATE_KEY`
- `MX402_LEDGER_CONTRACT`

## Roadmap To Full MVP Completion

The product is already beyond concept stage and into validated MVP territory, but the remaining polish areas are:

- fully browser-only repeatable demo flow without helper scripts
- cleaner provider payout and claim UX
- stronger operational monitoring and settlement visibility
- production-grade infrastructure hardening for all background jobs
- broader set of real third-party provider integrations beyond the demo provider layer

## License

No open-source license has been attached to this repository yet.
