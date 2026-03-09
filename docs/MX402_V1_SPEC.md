# MX402 Exchange V1 Implementation Spec

## Scope
This document turns the MVP architecture into a buildable v1 spec.

V1 constraints:
- one supported payment asset
- prepaid buyer balances
- off-chain request metering
- batched on-chain settlement
- curated providers only
- JSON APIs only
- one billable route per product
- fixed `price_per_call` billing only
- charge only on successful upstream response

## Global Rules
- Database: PostgreSQL 16
- Cache and locks: Redis 7
- Job queue: BullMQ
- Web app: Next.js
- Backend services: Node.js + TypeScript + Fastify
- Smart contract: MultiversX Rust framework
- ORM and migrations: Prisma
- All money values are stored as atomic units using `numeric(38,0)` in Postgres and serialized as strings in APIs
- All timestamps are UTC ISO-8601
- All primary keys are UUIDs unless otherwise noted
- Product slugs, provider slugs, and API key prefixes are lower-case ASCII

## Runtime Ownership
- `apps/web`: browser UI only
- `apps/api`: session auth, marketplace state, dashboards, admin, tx preparation
- `apps/gateway`: paid request execution and metering
- `apps/worker`: chain sync, reconciliation, settlement, payout state sync
- `contracts/mx402-ledger`: funds custody and settlement finality

## Database Schema
Use Prisma as the source of migration truth, but the relational model below is the contract for v1 behavior.

### Enums
```sql
create type provider_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type product_status as enum ('draft', 'pending_review', 'active', 'paused', 'archived');
create type project_status as enum ('active', 'suspended', 'archived');
create type api_key_status as enum ('active', 'revoked');
create type grant_status as enum ('active', 'revoked');
create type reservation_status as enum ('reserved', 'released', 'finalized');
create type usage_status as enum ('success', 'upstream_error', 'timeout', 'rejected');
create type settlement_batch_status as enum ('prepared', 'submitted', 'confirmed', 'failed');
create type settlement_line_type as enum ('buyer_debit', 'provider_credit', 'platform_fee');
create type chain_tx_kind as enum ('deposit', 'withdraw', 'settlement', 'provider_claim');
create type chain_tx_status as enum ('submitted', 'confirmed', 'failed');
create type http_method as enum ('GET', 'POST');
create type charge_policy as enum ('success_only');
create type origin_auth_mode as enum ('none', 'static_header');
create type idempotency_status as enum ('processing', 'completed', 'failed');
```

### `users`
```sql
create table users (
  id uuid primary key,
  wallet_address varchar(80) not null unique,
  display_name varchar(80),
  email varchar(255),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Rules:
- `wallet_address` is the canonical MultiversX address for browser login
- one row per wallet

### `wallet_sessions`
```sql
create table wallet_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_token_hash char(64) not null unique,
  native_auth_token_hash char(64) not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index wallet_sessions_user_id_idx on wallet_sessions(user_id);
create index wallet_sessions_expires_at_idx on wallet_sessions(expires_at);
```

Rules:
- browser auth uses an opaque `mx402_session` cookie
- raw Native Auth tokens are never stored, only hashes

### `providers`
```sql
create table providers (
  id uuid primary key,
  user_id uuid not null unique references users(id) on delete cascade,
  status provider_status not null default 'pending',
  slug varchar(64) not null unique,
  display_name varchar(120) not null,
  description text,
  website_url text,
  payout_wallet_address varchar(80) not null,
  approval_notes text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index providers_status_idx on providers(status);
```

Rules:
- a user can own at most one provider profile in v1
- `payout_wallet_address` must match a valid MultiversX address

### `provider_products`
```sql
create table provider_products (
  id uuid primary key,
  provider_id uuid not null references providers(id) on delete cascade,
  status product_status not null default 'draft',
  slug varchar(64) not null unique,
  name varchar(120) not null,
  short_description varchar(240) not null,
  description text,
  base_url text not null,
  upstream_path_template varchar(255) not null,
  upstream_method http_method not null,
  price_atomic numeric(38,0) not null,
  timeout_ms integer not null default 10000,
  rate_limit_per_minute integer not null default 60,
  charge_policy charge_policy not null default 'success_only',
  origin_auth_mode origin_auth_mode not null default 'none',
  origin_auth_header_name varchar(64),
  origin_auth_secret_ciphertext text,
  path_params_schema_json jsonb not null default '{}'::jsonb,
  input_schema_json jsonb not null default '{}'::jsonb,
  query_schema_json jsonb not null default '{}'::jsonb,
  output_schema_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_products_timeout_ck check (timeout_ms between 1000 and 30000),
  constraint provider_products_price_ck check (price_atomic > 0),
  constraint provider_products_rpm_ck check (rate_limit_per_minute between 1 and 10000),
  constraint provider_products_origin_auth_ck check (
    (origin_auth_mode = 'none' and origin_auth_header_name is null and origin_auth_secret_ciphertext is null) or
    (origin_auth_mode = 'static_header' and origin_auth_header_name is not null and origin_auth_secret_ciphertext is not null)
  )
);

create index provider_products_provider_id_idx on provider_products(provider_id);
create index provider_products_status_idx on provider_products(status);
```

Rules:
- one product equals one billable route in v1
- only `GET` and `POST` are supported
- `origin_auth_secret_ciphertext` is encrypted at rest

### `buyer_projects`
```sql
create table buyer_projects (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name varchar(120) not null,
  status project_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index buyer_projects_user_id_idx on buyer_projects(user_id);
create index buyer_projects_status_idx on buyer_projects(status);
```

Rules:
- a buyer can create multiple projects
- API keys belong to projects, not directly to wallets

### `project_api_keys`
```sql
create table project_api_keys (
  id uuid primary key,
  project_id uuid not null references buyer_projects(id) on delete cascade,
  name varchar(120) not null,
  key_prefix varchar(16) not null unique,
  secret_hash char(64) not null unique,
  status api_key_status not null default 'active',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index project_api_keys_project_id_idx on project_api_keys(project_id);
create index project_api_keys_status_idx on project_api_keys(status);
```

Rules:
- raw API key secret is shown only once at creation time
- gateway authenticates by `secret_hash`

### `project_product_grants`
```sql
create table project_product_grants (
  id uuid primary key,
  project_id uuid not null references buyer_projects(id) on delete cascade,
  product_id uuid not null references provider_products(id) on delete cascade,
  status grant_status not null default 'active',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (project_id, product_id)
);

create index project_product_grants_project_id_idx on project_product_grants(project_id);
create index project_product_grants_product_id_idx on project_product_grants(product_id);
```

Rules:
- a project must have an active grant before the gateway allows calls to that product

### `buyer_balances`
```sql
create table buyer_balances (
  user_id uuid primary key references users(id) on delete cascade,
  asset_identifier varchar(64) not null,
  onchain_confirmed_atomic numeric(38,0) not null default 0,
  reserved_atomic numeric(38,0) not null default 0,
  consumed_unsettled_atomic numeric(38,0) not null default 0,
  updated_at timestamptz not null default now(),
  constraint buyer_balances_non_negative_ck check (
    onchain_confirmed_atomic >= 0 and
    reserved_atomic >= 0 and
    consumed_unsettled_atomic >= 0
  )
);
```

Derived values:
- `spendable_atomic = onchain_confirmed_atomic - reserved_atomic - consumed_unsettled_atomic`

### `provider_balances`
```sql
create table provider_balances (
  provider_id uuid primary key references providers(id) on delete cascade,
  unsettled_earned_atomic numeric(38,0) not null default 0,
  claimable_onchain_atomic numeric(38,0) not null default 0,
  claimed_total_atomic numeric(38,0) not null default 0,
  updated_at timestamptz not null default now(),
  constraint provider_balances_non_negative_ck check (
    unsettled_earned_atomic >= 0 and
    claimable_onchain_atomic >= 0 and
    claimed_total_atomic >= 0
  )
);
```

### `gateway_idempotency_keys`
```sql
create table gateway_idempotency_keys (
  id uuid primary key,
  project_id uuid not null references buyer_projects(id) on delete cascade,
  product_id uuid not null references provider_products(id) on delete cascade,
  api_key_id uuid not null references project_api_keys(id) on delete cascade,
  idempotency_key varchar(128) not null,
  request_hash char(64) not null,
  status idempotency_status not null default 'processing',
  usage_receipt_id uuid,
  response_cache_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (project_id, product_id, idempotency_key)
);
```

Rules:
- duplicate `idempotency_key` with a different `request_hash` returns `409`
- completed keys replay the cached response without double-charging

### `usage_reservations`
```sql
create table usage_reservations (
  id uuid primary key,
  gateway_request_id uuid not null unique,
  project_id uuid not null references buyer_projects(id) on delete cascade,
  product_id uuid not null references provider_products(id) on delete cascade,
  api_key_id uuid not null references project_api_keys(id) on delete cascade,
  buyer_user_id uuid not null references users(id) on delete cascade,
  amount_atomic numeric(38,0) not null,
  status reservation_status not null default 'reserved',
  upstream_method http_method not null,
  upstream_path varchar(255) not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  released_at timestamptz,
  constraint usage_reservations_amount_ck check (amount_atomic > 0)
);

create index usage_reservations_buyer_status_idx on usage_reservations(buyer_user_id, status);
create index usage_reservations_project_id_idx on usage_reservations(project_id);
```

Rules:
- a reservation exists before any upstream request is sent
- finalization moves value from `reserved_atomic` to `consumed_unsettled_atomic`

### `usage_events`
```sql
create table usage_events (
  id uuid primary key,
  reservation_id uuid not null unique references usage_reservations(id) on delete cascade,
  project_id uuid not null references buyer_projects(id) on delete cascade,
  product_id uuid not null references provider_products(id) on delete cascade,
  provider_id uuid not null references providers(id) on delete cascade,
  api_key_id uuid not null references project_api_keys(id) on delete cascade,
  buyer_user_id uuid not null references users(id) on delete cascade,
  amount_atomic numeric(38,0) not null,
  request_status usage_status not null,
  upstream_status_code integer,
  upstream_latency_ms integer,
  request_bytes integer,
  response_bytes integer,
  charged boolean not null,
  settled_in_batch_id uuid references settlement_batches(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index usage_events_provider_id_idx on usage_events(provider_id);
create index usage_events_buyer_user_id_idx on usage_events(buyer_user_id);
create index usage_events_settled_in_batch_id_idx on usage_events(settled_in_batch_id);
```

Rules:
- only `charged = true` events participate in settlement
- `settled_in_batch_id` is null until confirmed on-chain

### `usage_receipts`
```sql
create table usage_receipts (
  id uuid primary key,
  usage_event_id uuid not null unique references usage_events(id) on delete cascade,
  public_receipt_id varchar(40) not null unique,
  asset_identifier varchar(64) not null,
  amount_atomic numeric(38,0) not null,
  buyer_wallet_address varchar(80) not null,
  provider_wallet_address varchar(80) not null,
  product_snapshot jsonb not null,
  chain_batch_id varchar(128),
  created_at timestamptz not null default now()
);
```

Rules:
- receipts are immutable once created
- `product_snapshot` stores display name, price, and route details as charged

### `settlement_batches`
```sql
create table settlement_batches (
  id uuid primary key,
  batch_id varchar(128) not null unique,
  status settlement_batch_status not null default 'prepared',
  asset_identifier varchar(64) not null,
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  total_buyer_debits_atomic numeric(38,0) not null,
  total_provider_credits_atomic numeric(38,0) not null,
  platform_fee_atomic numeric(38,0) not null,
  line_count integer not null,
  tx_hash varchar(80),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz
);

create index settlement_batches_status_idx on settlement_batches(status);
```

Rules:
- `total_buyer_debits_atomic = total_provider_credits_atomic + platform_fee_atomic`
- `batch_id` is deterministic and reused on retries

### `settlement_lines`
```sql
create table settlement_lines (
  id uuid primary key,
  batch_ref uuid not null references settlement_batches(id) on delete cascade,
  line_type settlement_line_type not null,
  buyer_user_id uuid references users(id) on delete cascade,
  provider_id uuid references providers(id) on delete cascade,
  amount_atomic numeric(38,0) not null,
  source_usage_event_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint settlement_lines_amount_ck check (amount_atomic > 0)
);

create index settlement_lines_batch_ref_idx on settlement_lines(batch_ref);
```

Rules:
- `buyer_debit` lines must have `buyer_user_id`
- `provider_credit` lines must have `provider_id`
- `platform_fee` lines have neither

### `chain_transactions`
```sql
create table chain_transactions (
  id uuid primary key,
  tx_hash varchar(80) not null unique,
  tx_kind chain_tx_kind not null,
  status chain_tx_status not null,
  wallet_address varchar(80) not null,
  related_user_id uuid references users(id) on delete set null,
  related_provider_id uuid references providers(id) on delete set null,
  related_batch_id uuid references settlement_batches(id) on delete set null,
  amount_atomic numeric(38,0),
  nonce bigint,
  block_nonce bigint,
  raw_response_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index chain_transactions_related_user_id_idx on chain_transactions(related_user_id);
create index chain_transactions_related_provider_id_idx on chain_transactions(related_provider_id);
create index chain_transactions_related_batch_id_idx on chain_transactions(related_batch_id);
```

### `admin_audit_logs`
```sql
create table admin_audit_logs (
  id uuid primary key,
  actor_user_id uuid not null references users(id) on delete cascade,
  action varchar(80) not null,
  entity_type varchar(40) not null,
  entity_id uuid,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

## Data Invariants
- `spendable_atomic` must never be negative
- `reserved_atomic + consumed_unsettled_atomic` must never exceed `onchain_confirmed_atomic`
- every charged request must produce exactly one `usage_event` and one `usage_receipt`
- every `usage_event` can belong to at most one settlement batch
- settlement retries must reuse the same `batch_id`
- gateway never forwards a request before creating a reservation

## Contract Interface
The v1 contract is a narrow ledger and settlement contract. It does not know about products, API keys, or request-level events.

### Stored State
- `supported_token_id: EgldOrEsdtTokenIdentifier`
- `fee_bps: u16`
- `paused: bool`
- `owner: ManagedAddress`
- `operator: ManagedAddress`
- `treasury_address: ManagedAddress`
- `buyer_balance[address] -> BigUint`
- `provider_payout_address[provider_id_bytes] -> ManagedAddress`
- `provider_claimable[provider_id_bytes] -> BigUint`
- `processed_batch[batch_id_bytes] -> bool`

### Value Types
```rust
#[type_abi]
pub struct BuyerDebit<M: ManagedTypeApi> {
    pub buyer: ManagedAddress<M>,
    pub amount: BigUint<M>,
}

#[type_abi]
pub struct ProviderCredit<M: ManagedTypeApi> {
    pub provider_id: ManagedBuffer<M>,
    pub amount: BigUint<M>,
}
```

### Init
```rust
#[init]
fn init(
    &self,
    supported_token_id: EgldOrEsdtTokenIdentifier,
    fee_bps: u16,
    operator: ManagedAddress,
    treasury_address: ManagedAddress,
);
```

Rules:
- `fee_bps <= 10_000`
- only one supported token for v1

### Endpoints
```rust
#[payable("*")]
#[endpoint(deposit)]
fn deposit(&self);

#[endpoint(withdraw)]
fn withdraw(&self, amount: BigUint);

#[only_owner]
#[endpoint(registerProvider)]
fn register_provider(&self, provider_id: ManagedBuffer, payout_address: ManagedAddress);

#[only_owner]
#[endpoint(updateProviderPayout)]
fn update_provider_payout(&self, provider_id: ManagedBuffer, payout_address: ManagedAddress);

#[only_role(OPERATOR_ROLE)]
#[endpoint(applySettlementBatch)]
fn apply_settlement_batch(
    &self,
    batch_id: ManagedBuffer,
    buyer_debits: MultiValueEncoded<BuyerDebit<Self::Api>>,
    provider_credits: MultiValueEncoded<ProviderCredit<Self::Api>>,
    fee_amount: BigUint,
);

#[endpoint(claimProviderEarnings)]
fn claim_provider_earnings(
    &self,
    provider_id: ManagedBuffer,
    opt_amount: OptionalValue<BigUint>,
);

#[only_owner]
#[endpoint(setFeeBps)]
fn set_fee_bps(&self, fee_bps: u16);

#[only_owner]
#[endpoint(setOperator)]
fn set_operator(&self, operator: ManagedAddress);

#[only_owner]
#[endpoint(setTreasuryAddress)]
fn set_treasury_address(&self, treasury_address: ManagedAddress);

#[only_owner]
#[endpoint(pause)]
fn pause(&self);

#[only_owner]
#[endpoint(unpause)]
fn unpause(&self);
```

### Views
```rust
#[view(getBuyerBalance)]
fn get_buyer_balance(&self, buyer: ManagedAddress) -> BigUint;

#[view(getProviderPayoutAddress)]
fn get_provider_payout_address(&self, provider_id: ManagedBuffer) -> ManagedAddress;

#[view(getProviderClaimable)]
fn get_provider_claimable(&self, provider_id: ManagedBuffer) -> BigUint;

#[view(isBatchProcessed)]
fn is_batch_processed(&self, batch_id: ManagedBuffer) -> bool;

#[view(getConfig)]
fn get_config(&self) -> Config<Self::Api>;
```

### Contract Rules
- `deposit()` only accepts the configured token
- `withdraw(amount)` can only withdraw the caller's available on-chain balance
- `registerProvider()` must fail if the provider already exists
- `updateProviderPayout()` must fail if the provider is not registered
- `claim_provider_earnings()` requires `caller == provider_payout_address[provider_id]`
- `applySettlementBatch()` must fail if `batch_id` was already processed
- `applySettlementBatch()` must fail unless `sum(buyer_debits) = sum(provider_credits) + fee_amount`
- `applySettlementBatch()` must fail if any buyer balance would go negative
- `applySettlementBatch()` must fail if any credited provider is unregistered

### Events
```rust
#[event("deposit")]
fn deposit_event(
    buyer: &ManagedAddress,
    amount: &BigUint,
);

#[event("withdraw")]
fn withdraw_event(
    buyer: &ManagedAddress,
    amount: &BigUint,
);

#[event("provider_registered")]
fn provider_registered_event(
    provider_id: &ManagedBuffer,
    payout_address: &ManagedAddress,
);

#[event("provider_payout_updated")]
fn provider_payout_updated_event(
    provider_id: &ManagedBuffer,
    payout_address: &ManagedAddress,
);

#[event("settlement_batch_applied")]
fn settlement_batch_applied_event(
    batch_id: &ManagedBuffer,
    total_buyer_debits: &BigUint,
    total_provider_credits: &BigUint,
    fee_amount: &BigUint,
);

#[event("provider_claimed")]
fn provider_claimed_event(
    provider_id: &ManagedBuffer,
    payout_address: &ManagedAddress,
    amount: &BigUint,
);
```

## REST API
All API routes are served from `apps/api` except the gateway routes.

Conventions:
- session auth uses `mx402_session` httpOnly cookie
- public endpoints are read-only
- admin endpoints require `users.is_admin = true`
- all amount fields are strings
- list endpoints use cursor pagination with `limit` and `cursor`

### Auth
#### `POST /v1/auth/native-auth/login`
Purpose:
- verify MultiversX Native Auth token and create a browser session

Request:
```json
{
  "nativeAuthToken": "..."
}
```

Response `200`:
```json
{
  "user": {
    "id": "uuid",
    "walletAddress": "erd1...",
    "displayName": null,
    "isAdmin": false
  },
  "expiresAt": "2026-03-09T15:00:00Z"
}
```

Behavior:
- creates user row if wallet is first-seen
- sets `mx402_session` cookie

#### `POST /v1/auth/logout`
Purpose:
- revoke current session

Response `204`

#### `GET /v1/me`
Purpose:
- return current user and linked provider summary if present

### Marketplace
#### `GET /v1/products`
Purpose:
- list active marketplace products

Query:
- `cursor`
- `limit`
- `providerSlug`

Response fields:
- `id`
- `slug`
- `name`
- `shortDescription`
- `priceAtomic`
- `provider.displayName`
- `pathParamsSchemaJson`
- `inputSchemaJson`
- `querySchemaJson`

#### `GET /v1/products/:productId`
Purpose:
- return full product details for marketplace display

### Provider
#### `POST /v1/providers`
Purpose:
- create a provider profile

Request:
```json
{
  "slug": "chain-signal",
  "displayName": "Chain Signal",
  "description": "Token and wallet analytics APIs",
  "websiteUrl": "https://example.com",
  "payoutWalletAddress": "erd1..."
}
```

Response `201`:
- provider object with `status = pending`

#### `GET /v1/providers/me`
Purpose:
- fetch the authenticated provider profile

#### `PATCH /v1/providers/me`
Purpose:
- update provider metadata or payout wallet

Rules:
- payout wallet changes set provider back to `pending` review if already approved

#### `POST /v1/providers/me/products`
Purpose:
- create a draft product

Request:
```json
{
  "slug": "wallet-risk-score",
  "name": "Wallet Risk Score",
  "shortDescription": "Returns a risk score for a wallet address",
  "description": "Detailed description",
  "baseUrl": "https://api.provider.com",
  "upstreamPathTemplate": "/risk/{address}",
  "upstreamMethod": "GET",
  "priceAtomic": "1000000",
  "timeoutMs": 5000,
  "rateLimitPerMinute": 120,
  "originAuthMode": "static_header",
  "originAuthHeaderName": "x-origin-token",
  "originAuthSecret": "secret-value",
  "pathParamsSchemaJson": {},
  "inputSchemaJson": {},
  "querySchemaJson": {},
  "outputSchemaJson": {}
}
```

Rules:
- `originAuthSecret` is accepted only at write time and stored encrypted

#### `GET /v1/providers/me/products`
Purpose:
- list the provider's draft, review, and active products

#### `GET /v1/providers/me/products/:productId`
Purpose:
- fetch one provider-owned product

#### `PATCH /v1/providers/me/products/:productId`
Purpose:
- update a draft or paused product

#### `POST /v1/providers/me/products/:productId/submit`
Purpose:
- move a draft product to `pending_review`

Response `202`

### Buyer Projects and Keys
#### `POST /v1/projects`
Purpose:
- create a buyer project

Request:
```json
{
  "name": "My Agent"
}
```

#### `GET /v1/projects`
Purpose:
- list buyer-owned projects

#### `GET /v1/projects/:projectId`
Purpose:
- fetch a project plus active product grants

#### `POST /v1/projects/:projectId/grants`
Purpose:
- grant a project access to a marketplace product

Request:
```json
{
  "productId": "uuid"
}
```

Rules:
- project owner only
- product must be `active`

#### `DELETE /v1/projects/:projectId/grants/:productId`
Purpose:
- revoke project access to a product

#### `POST /v1/projects/:projectId/api-keys`
Purpose:
- mint an API key for a project

Request:
```json
{
  "name": "production"
}
```

Response `201`:
```json
{
  "id": "uuid",
  "name": "production",
  "keyPrefix": "mxp_live_8f3a",
  "secret": "mxp_live_8f3a....",
  "createdAt": "2026-03-09T15:00:00Z"
}
```

#### `GET /v1/projects/:projectId/api-keys`
Purpose:
- list API keys without returning raw secrets

#### `DELETE /v1/projects/:projectId/api-keys/:keyId`
Purpose:
- revoke an API key

Response `204`

### Balance and On-Chain Actions
#### `GET /v1/balance`
Purpose:
- return the buyer's mirrored balance

Response `200`:
```json
{
  "assetIdentifier": "TOKEN-123456",
  "onchainConfirmedAtomic": "10000000",
  "reservedAtomic": "1000000",
  "consumedUnsettledAtomic": "2000000",
  "spendableAtomic": "7000000"
}
```

#### `POST /v1/balance/deposit/prepare`
Purpose:
- return transaction details for a wallet-signed contract deposit

Request:
```json
{
  "amountAtomic": "5000000"
}
```

Response `200`:
```json
{
  "contractAddress": "erd1...",
  "chainId": "D",
  "function": "deposit",
  "tokenIdentifier": "TOKEN-123456",
  "amountAtomic": "5000000",
  "gasLimit": 12000000
}
```

#### `POST /v1/balance/deposits/track`
Purpose:
- register a submitted deposit transaction hash so the worker can index and mirror it after on-chain confirmation

Request:
```json
{
  "txHash": "abc123...",
  "amountAtomic": "5000000"
}
```

Rules:
- requires authenticated buyer session
- `amountAtomic` is optional metadata for pending UI state; the worker treats on-chain data as authoritative

#### `POST /v1/balance/withdraw/prepare`
Purpose:
- return transaction details for a wallet-signed withdrawal

Request:
```json
{
  "amountAtomic": "1000000"
}
```

#### `GET /v1/chain-transactions`
Purpose:
- list the authenticated user's deposits, withdrawals, and claims

### Usage and Receipts
#### `GET /v1/usage/events`
Purpose:
- list charged and non-charged usage for the authenticated buyer

Query:
- `projectId`
- `productId`
- `cursor`
- `limit`

#### `GET /v1/usage/receipts/:receiptId`
Purpose:
- return one immutable receipt by `public_receipt_id`

Response fields:
- `receiptId`
- `product`
- `amountAtomic`
- `assetIdentifier`
- `chargedAt`
- `chainBatchId`
- `buyerWalletAddress`
- `providerWalletAddress`

### Provider Earnings
#### `GET /v1/providers/me/earnings`
Purpose:
- return earnings summary for the authenticated provider

Response `200`:
```json
{
  "assetIdentifier": "TOKEN-123456",
  "unsettledEarnedAtomic": "2500000",
  "claimableOnchainAtomic": "1000000",
  "claimedTotalAtomic": "500000"
}
```

#### `POST /v1/providers/me/claim/prepare`
Purpose:
- return transaction details for a provider claim call

Request:
```json
{
  "amountAtomic": "1000000"
}
```

Response:
- contract address
- function `claimProviderEarnings`
- serialized `providerId`
- gas limit

### Admin
#### `GET /v1/admin/providers`
Purpose:
- list providers by status

#### `POST /v1/admin/providers/:providerId/approve`
Purpose:
- approve a provider profile

Behavior:
- writes audit log
- enqueues on-chain provider registration if not yet registered

#### `POST /v1/admin/providers/:providerId/reject`
Purpose:
- reject a provider profile

#### `POST /v1/admin/products/:productId/activate`
Purpose:
- activate a reviewed product

#### `POST /v1/admin/products/:productId/pause`
Purpose:
- pause an active product

#### `GET /v1/admin/settlement-batches`
Purpose:
- list settlement batches and statuses

#### `POST /v1/admin/settlement-batches/:batchId/retry`
Purpose:
- requeue a failed settlement batch

## Gateway Request and Response Model
All paid execution routes are served from `apps/gateway`.

### Authentication
- header: `Authorization: Bearer <project_api_key>`
- header: `Idempotency-Key: <client-generated-unique-key>`
- only active API keys are accepted
- API key must belong to a project with an active grant for the target product

### Route
#### `POST /v1/gateway/products/:productId/call`

Purpose:
- execute one billable product call through the metering gateway

Request body:
```json
{
  "pathParams": {
    "address": "erd1..."
  },
  "query": {
    "network": "mainnet"
  },
  "body": null
}
```

Rules:
- `pathParams` is used to render `upstream_path_template`
- `query` is optional
- `body` must be JSON if present
- `pathParams` must validate against `path_params_schema_json` if configured
- `body` must validate against `input_schema_json` if configured
- `query` must validate against `query_schema_json` if configured

Gateway execution order:
1. authenticate API key
2. load project, buyer, product, and grant
3. check project and product are active
4. acquire idempotency record
5. check `spendable_atomic >= price_atomic`
6. create `usage_reservation`
7. increment buyer `reserved_atomic`
8. forward upstream request
9. if upstream succeeds:
10. finalize reservation
11. decrement `reserved_atomic`
12. increment `consumed_unsettled_atomic`
13. create `usage_event`
14. create `usage_receipt`
15. increment provider `unsettled_earned_atomic`
16. cache response for idempotent replay
17. return success payload
18. if upstream fails or times out:
19. release reservation
20. decrement `reserved_atomic`
21. create non-charged `usage_event`
22. return error without charging

Success response `200`:
```json
{
  "receiptId": "rcpt_01JQ...",
  "productId": "uuid",
  "assetIdentifier": "TOKEN-123456",
  "chargedAtomic": "1000000",
  "balanceRemainingAtomic": "9000000",
  "providerStatus": 200,
  "durationMs": 312,
  "data": {
    "score": 17
  }
}
```

Response headers:
- `X-MX402-Receipt-Id`
- `X-MX402-Charged-Atomic`
- `X-MX402-Balance-Remaining-Atomic`

### Error Responses
#### `401 Unauthorized`
```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "API key is invalid or revoked"
  }
}
```

#### `403 Forbidden`
```json
{
  "error": {
    "code": "PRODUCT_NOT_GRANTED",
    "message": "This project is not allowed to call the selected product"
  }
}
```

#### `402 Payment Required`
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient spendable balance for this request",
    "productId": "uuid",
    "assetIdentifier": "TOKEN-123456",
    "requiredAtomic": "1000000",
    "availableAtomic": "250000",
    "topUpUrl": "/billing/top-up"
  }
}
```

#### `409 Conflict`
```json
{
  "error": {
    "code": "IDEMPOTENCY_MISMATCH",
    "message": "This idempotency key was already used for a different request"
  }
}
```

#### `422 Unprocessable Entity`
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Request does not match the product schema"
  }
}
```

#### `429 Too Many Requests`
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded for this project or product"
  }
}
```

#### `502 Bad Gateway`
```json
{
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "Provider request failed",
    "charged": false
  }
}
```

#### `504 Gateway Timeout`
```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "Provider request timed out",
    "charged": false
  }
}
```

## Worker Jobs
### `sync-chain-events`
- ingest deposit, withdraw, settlement, and claim events from MultiversX
- update `buyer_balances.onchain_confirmed_atomic`
- update `provider_balances.claimable_onchain_atomic`
- create or update `chain_transactions`

### `create-settlement-batch`
- select charged `usage_events` with `settled_in_batch_id is null`
- aggregate by buyer and provider
- compute fee
- write `settlement_batches` and `settlement_lines`

### `submit-settlement-batch`
- call `applySettlementBatch`
- mark batch `submitted`
- write settlement `chain_transactions`

### `confirm-settlement-batch`
- on confirmation:
  - mark batch `confirmed`
  - set `usage_events.settled_in_batch_id`
  - decrement buyer `consumed_unsettled_atomic`
  - decrement provider `unsettled_earned_atomic`
  - increment provider `claimable_onchain_atomic`

## Environment Variables
### Shared
- `MX402_ENV`
- `MX402_ASSET_IDENTIFIER`
- `MX402_CHAIN_ID`

### API
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SIGNING_SECRET`
- `MULTIVERSX_API_URL`
- `MULTIVERSX_GATEWAY_URL`
- `MX402_LEDGER_CONTRACT`
- `NATIVE_AUTH_ALLOWED_ORIGINS`
- `ORIGIN_SECRET_ENCRYPTION_KEY`

### Gateway
- `DATABASE_URL`
- `REDIS_URL`
- `GATEWAY_RESPONSE_CACHE_TTL_SECONDS`
- `GATEWAY_RESERVATION_TTL_SECONDS`

### Worker
- `DATABASE_URL`
- `REDIS_URL`
- `MULTIVERSX_API_URL`
- `MULTIVERSX_GATEWAY_URL`
- `SETTLEMENT_WINDOW_MINUTES`
- `SETTLEMENT_OPERATOR_PRIVATE_KEY`

## Build Sequence
1. Create Prisma schema from the tables above
2. Implement contract endpoints and event tests
3. Implement `POST /v1/auth/native-auth/login`
4. Implement provider profile and product CRUD
5. Implement project, API key, and grant flows
6. Implement balance mirror and deposit sync
7. Implement gateway reservation and success-charge flow
8. Implement usage receipts and buyer dashboards
9. Implement settlement batch pipeline
10. Implement provider claim flow

## References
- https://docs.multiversx.com/sdk-and-tools/sdk-dapp/
- https://docs.multiversx.com/sdk-and-tools/sdk-js/
- https://docs.multiversx.com/sdk-and-tools/rest-api/
- https://docs.multiversx.com/sdk-and-tools/chain-simulator/
- https://docs.multiversx.com/developers/smart-contracts/
- https://multiversx.com/builders/builder-tools-resources
