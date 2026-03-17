# Contract Privileged Surface Inventory

This document tracks mutable privileged surfaces for the prediction-market launch scope and their current guardrails.

## EVM: `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`

- `setReporter` / `setFinalizer` / `setChallenger`: `DEFAULT_ADMIN_ROLE`, now
  immutable in PM20 (`GovernanceSurfaceFrozen` on any setter call post-deploy)
- `setPauser` / `setOraclePaused`: `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` respectively
- `upsertDuel` / `proposeResult` / `challengeResult` / `finalizeResult`: role-gated as defined in the contract
- `cancelDuel`: **`PAUSER_ROLE`** (emergency/finality control path)

## EVM: `packages/evm-contracts/contracts/GoldClob.sol`

- `setOracle` / `setTreasury` / `setMarketMaker` / `setFeeConfig`: `DEFAULT_ADMIN_ROLE`, now
  immutable in PM20 (`GovernanceSurfaceFrozen` on any setter call post-deploy)
- `setMarketCreationPaused` / `setOrderPlacementPaused`: `PAUSER_ROLE`
- `syncMarketFromOracle`, `createMarketForDuel`, `placeOrder`, `claim`: caller/market state and lifecycle checks; not role-admin paths

## SVM: `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`

- `initializeOracle`: upgrade-authority constrained initializer for `OracleConfig` (no bootstrap fallback)
- `updateOracleConfig`: `authority` signer; authority key is immutable in PM20 and cannot be reassigned
- `upsert_duel`: oracle `reporter`
- `challenge_result`: oracle `challenger`
- `cancel_duel` / `finalize_result`: oracle `authority` / `finalizer` as configured

## SVM: `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`

- `initialize_config`: upgrade-authority constrained initializer for `MarketConfig` (no bootstrap fallback)
- `update_config`: `authority` signer; authority key is immutable in PM20 and cannot be reassigned
- `initialize_market`: market operator or config authority
- `place_order`, `cancel_order`, `claim`, `sync_market_from_duel`, `initialize_market`: state-transition guards and policy checks on each invocation

## Governance evidence

- Role owner and privileged mutators are now intentionally frozen by PM20 policy.
- Any role owner change requires tracked PR evidence through the lane-specific release docs.
- This inventory is updated as part of Gate `20` and `22` handoff.
