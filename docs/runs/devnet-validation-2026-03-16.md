# MX402 Devnet Validation - 2026-03-16

## Summary
A fresh EGLD ledger contract was deployed on MultiversX Devnet and validated with separate wallets for owner, provider, and buyer.

Validated flow:
1. Provider profile created and approved
2. Product created, submitted, and activated
3. Buyer deposited EGLD to the ledger
4. Buyer executed a paid gateway call
5. Usage was batched into on-chain settlement
6. Provider claimed settled earnings on-chain

## Wallet Roles
- Owner/admin: `erd18v795sgulkln9dqf8m3um37tnl4kyhexydhv4zs804wf6z3ktqsq5lth8j`
- Provider: `erd1qx7zqaa2v83zjmjmrf67jm9zrap3wf4uesym943lufef9eqwqr8qv2pg4f`
- Buyer: `erd1y8n5hxm98lghhktpau0cvk2q3uv8vptf9eqdlnjygtx4u9nxlrqsuc8tex`

## Ledger Contract
- Contract address: `erd1qqqqqqqqqqqqqpgqe00lpfaeprevlmj2fj2eezygrp7ljy2dtqsqndmsz6`
- Asset: `EGLD`
- Fee bps: `250`

## Devnet Transactions
- Deploy: `03154556dbacdc403a79efcf85a24bbc9910c79ad31777e8406b906b30393093`
- Provider register: `a5c52011205829ad8e1a6eb4cee3b81fad788ef2d0b13f5b69c4babad0c52c1b`
- Buyer deposit: `ef86eb1d9337ca0eb1e1823e3da10ce83ec3ee0f986238091536597f5ff57cf2`
- Settlement batch: `7f80b068f5d618482eec6d65dd4c2439eadad02150965ccf2e10af2e776ecd5b`
- Provider claim: `5862fd231245458fac7e3bd0f998bbbe1dd10488d2fb0d890c47a58bef86a764`

Explorer links:
- https://devnet-explorer.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgqe00lpfaeprevlmj2fj2eezygrp7ljy2dtqsqndmsz6
- https://devnet-explorer.multiversx.com/transactions/03154556dbacdc403a79efcf85a24bbc9910c79ad31777e8406b906b30393093
- https://devnet-explorer.multiversx.com/transactions/a5c52011205829ad8e1a6eb4cee3b81fad788ef2d0b13f5b69c4babad0c52c1b
- https://devnet-explorer.multiversx.com/transactions/ef86eb1d9337ca0eb1e1823e3da10ce83ec3ee0f986238091536597f5ff57cf2
- https://devnet-explorer.multiversx.com/transactions/7f80b068f5d618482eec6d65dd4c2439eadad02150965ccf2e10af2e776ecd5b
- https://devnet-explorer.multiversx.com/transactions/5862fd231245458fac7e3bd0f998bbbe1dd10488d2fb0d890c47a58bef86a764

## Scenario Output
- Tests run: `1`
- Receipt id: `rcpt_2e0c66573712da9d7d00`
- Product id: `bd2576e8-1ad1-41c0-84e1-3ec3d4f31b43`
- Provider id: `085751f2-2b02-49d9-ae3c-e1c86c8d1374`
- Buyer deposit amount: `0.02 EGLD`
- Charged amount: `0.001 EGLD`
- Provider credit after settlement: `0.000975 EGLD`
- Provider claim total after claim: `0.000975 EGLD`
- Buyer remaining spendable after the call: `0.019 EGLD`

## Runtime Notes
- The local runtime was updated to use the new ledger contract and `EGLD` in `.env.local`.
- For this validation run, chain-read polling used the public devnet API and gateway because the Kepler chain-read gateway lagged transaction finality for newly submitted devnet transactions.
- The buyer claimable balance and settlement confirmation both reached `confirmed=1`, `failed=0`, `pending=0` in the scenario run.
