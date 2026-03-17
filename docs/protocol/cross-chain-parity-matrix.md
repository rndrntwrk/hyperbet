# Cross-Chain Parity Matrix (EVM vs SVM)

## Runtime Surfaces

- EVM contracts:
  - `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
  - `packages/evm-contracts/contracts/GoldClob.sol`
- SVM programs:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`

## Behavior Mapping

| Behavior | EVM surface | SVM surface | Notes |
|---|---|---|---|
| Initialize oracle authority/config | `DuelOutcomeOracle.constructor(admin, reporter)` | `fight_oracle::initialize_oracle(reporter)` | EVM uses AccessControl bootstrap; SVM uses upgrade-authority-only PDA init, with no bootstrap-authority fallback. |
| Rotate reporter | `setReporter(reporter, enabled)` | `update_oracle_config(authority, reporter)` | Both privileged. |
| Upsert duel lifecycle | `upsertDuel(...)` | `upsert_duel(...)` | Monotonic lifecycle progression enforced on both. |
| Cancel duel | `cancelDuel(duelKey, metadataUri)` | `cancel_duel(duel_key, metadata_uri)` | Finalization guard on both. |
| Report duel result | `proposeResult(...)` | `propose_result(...)` | Requires winner `A/B`; end timestamp validity checks. |
| Create market | `createMarketForDuel(duelKey, marketKind)` | `initialize_market(duel_key, market_kind)` | Allowed when duel is marketable (`BETTING_OPEN/LOCKED`). |
| Sync market lifecycle from oracle | `syncMarketFromOracle(duelKey, marketKind)` | `sync_market_from_duel()` | Winner propagation on resolve; winner reset on cancel. |
| Place order | `placeOrder(duelKey, marketKind, side, price, amount)` | `place_order(order_id, side, price, amount)` | Both validate side, price, status OPEN, and betting window before accepting matches. |
| Cancel order | `cancelOrder(duelKey, marketKind, orderId)` | `cancel_order(order_id, side, price)` | Maker-only cancellation of active remainder; cancellation is now restricted to `OPEN` markets on both chains. |
| Claim settlement | `claim(duelKey, marketKind)` | `claim()` | Resolved = winner payout less fee; Cancelled = refund locked stake; nonterminal claims must revert. |
| Update fee config | `setFeeConfig(...)` | `update_config(...trade/winnings fee bps...)` | Both enforce BPS bounds. |
| Update treasury | `setTreasury(address)` | `update_config(...treasury...)` | SVM packed into config update. |
| Update market maker fee account | `setMarketMaker(address)` | `update_config(...market_maker...)` | SVM packed into config update. |
| Update oracle pointer | `setOracle(address)` | N/A (oracle account wired by account constraints) | EVM explicit mutable oracle address; SVM uses account graph checks. |
| Market status mapping | `_mapDuelStatus(...)` | `map_duel_status(...)` | SVM maps `Scheduled -> Locked`; EVM duel market creation avoids scheduled markets. |
| Quote/lock arithmetic | `_quoteCost(...)` | `quote_cost(...)` | Same 1000-tick economics. |

## Privileged Function Map

| Chain | Surface | Privilege gate |
|---|---|---|
| EVM | `DuelOutcomeOracle.setReporter` | `DEFAULT_ADMIN_ROLE` |
| EVM | `DuelOutcomeOracle.upsertDuel` | `REPORTER_ROLE` |
| EVM | `DuelOutcomeOracle.cancelDuel` | `PAUSER_ROLE` |
| EVM | `DuelOutcomeOracle.proposeResult` | `REPORTER_ROLE` |
| EVM | `GoldClob.createMarketForDuel` | `MARKET_OPERATOR_ROLE` |
| EVM | `GoldClob.setOracle` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setTreasury` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setMarketMaker` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setFeeConfig` | `DEFAULT_ADMIN_ROLE` |
| SVM | `fight_oracle::initialize_oracle` | upgrade authority only |
| SVM | `fight_oracle::update_oracle_config` | oracle config `authority` signer |
| SVM | `fight_oracle::upsert_duel` | oracle config `reporter` signer |
| SVM | `fight_oracle::cancel_duel` | oracle config `authority` signer |
| SVM | `fight_oracle::propose_result` | oracle config `reporter` signer |
| SVM | `gold_clob_market::initialize_config` | upgrade authority only |
| SVM | `gold_clob_market::update_config` | market config `authority` signer |
| SVM | `gold_clob_market::initialize_market` | config `authority` or `market_operator` signer |

## Trace Coverage

The integration branch treats the commands below as the concrete parity evidence
set for lifecycle traces. EVM protocol traces are shared by BSC and AVAX
because both chains consume the same `DuelOutcomeOracle` and `GoldClob`
contracts.

| Trace | Solana evidence | BSC evidence | AVAX evidence |
|---|---|---|---|
| Place order | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Partial fill | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Cancel active order | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Lock / non-quotable transition | `bun run ci:gate:solana` | `bun run ci:gate:evm` | `bun run ci:gate:evm` |
| Propose result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Challenge result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Finalize result | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Cancel duel / market cancellation | `bun run --cwd packages/hyperbet-solana anchor:test` | `bun run ci:contracts:proof` | `bun run ci:contracts:proof` |
| Claim resolved winner | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |
| Refund cancelled market | `node --import tsx scripts/ci-gate-e2e.ts --chain=solana` | `node --import tsx scripts/ci-gate-e2e.ts --chain=bsc` | `node --import tsx scripts/ci-gate-e2e.ts --chain=avax` |

## PM21 Guardrail Evidence

- EVM guardrail regression suite: `packages/evm-contracts/test/ExploitSuite.t.sol`
- SVM guardrail regression suite: `packages/hyperbet-solana/anchor/tests/gold_clob_security.ts`
- Settlement parity references:
  - `packages/evm-contracts/test/GoldClobSettlement.t.sol`
  - `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`

Both sides enforce the same lifecycle restrictions:
- Non-open markets (LOCKED/PROPOSED/CHALLENGED/RESOLVED/CANCELLED) reject order mutations with `MarketNotOpen` equivalents.
- Only terminal states permit settlement claims; settled behavior is exact and symmetric (`resolved` payout, `cancelled` refund).

## API Contract Checks

These checks prove that the normalized lifecycle API remains stable across UI,
MM, and keeper consumers:

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test --preload ./tests/setup.ts` in `packages/hyperbet-ui`
- `bunx vitest run` in `packages/market-maker-bot`
- `packages/*/app/tests/e2e/app-tabs-and-apis.spec.ts` via `scripts/ci-gate-e2e.ts`
