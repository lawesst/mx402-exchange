# MX402 Exchange

MX402 Exchange is a MultiversX-native pay-per-API marketplace MVP.

This workspace is scaffolded from the implementation spec in:
- `docs/MX402_EXCHANGE.md`
- `docs/MX402_ARCHITECTURE.md`
- `docs/MX402_V1_SPEC.md`

## Workspace Layout
- `apps/api` - marketplace API, auth, admin, tx preparation
- `apps/gateway` - paid request execution and metering
- `apps/worker` - chain sync and settlement jobs
- `apps/web` - marketplace and dashboard UI
- `contracts/mx402-ledger` - MultiversX ledger contract stub
- `packages/*` - shared config, domain types, DB, observability, SDKs

## Current State
- Root workspace scaffolded
- Prisma schema scaffolded
- API, gateway, worker, and web starter code scaffolded
- Contract interface stub scaffolded
- Business logic is intentionally incomplete and follows the spec as TODOs

## Chain Infrastructure
- Node services auto-load `.env` and `.env.local` by walking up from the current working directory.
- Browser login and wallet flows should use public MultiversX endpoints via:
  - `NEXT_PUBLIC_MULTIVERSX_API_URL`
  - `NEXT_PUBLIC_MULTIVERSX_WALLET_URL`
  - `NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL`
- Server-side chain reads can use dedicated private endpoints via:
  - `MULTIVERSX_CHAIN_API_URL`
  - `MULTIVERSX_CHAIN_GATEWAY_URL`
  - `MULTIVERSX_CHAIN_API_KEY`
  - `MULTIVERSX_CHAIN_EVENTS_URL`

Recommended Kepler devnet wiring for server-side reads:
```env
MULTIVERSX_CHAIN_API_URL=https://kepler-api.projectx.mx/devnet/api
MULTIVERSX_CHAIN_GATEWAY_URL=https://kepler-api.projectx.mx/devnet/gateway
MULTIVERSX_CHAIN_EVENTS_URL=wss://kepler-api.projectx.mx/devnet/events
MULTIVERSX_CHAIN_API_KEY=...
```

The worker uses the optional chain-read endpoints first and sends the key as an `Api-Key` header.
