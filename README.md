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
