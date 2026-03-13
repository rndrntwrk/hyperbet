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
| Initialize oracle authority/config | `DuelOutcomeOracle.constructor(admin, reporter)` | `fight_oracle::initialize_oracle(reporter)` | EVM uses AccessControl bootstrap; SVM uses PDA config with upgrade authority gate. |
| Rotate reporter | `setReporter(reporter, enabled)` | `update_oracle_config(authority, reporter)` | Both privileged. |
| Upsert duel lifecycle | `upsertDuel(...)` | `upsert_duel(...)` | Monotonic lifecycle progression enforced on both. |
| Cancel duel | `cancelDuel(duelKey, metadataUri)` | `cancel_duel(duel_key, metadata_uri)` | Finalization guard on both. |
| Report duel result | `reportResult(...)` | `report_result(...)` | Requires winner `A/B`; end timestamp validity checks. |
| Create market | `createMarketForDuel(duelKey, marketKind)` | `initialize_market(duel_key, market_kind)` | Allowed when duel is marketable (`BETTING_OPEN/LOCKED`). |
| Sync market lifecycle from oracle | `syncMarketFromOracle(duelKey, marketKind)` | `sync_market_from_duel()` | Winner propagation on resolve; winner reset on cancel. |
| Place order | `placeOrder(duelKey, marketKind, side, price, amount)` | `place_order(order_id, side, price, amount)` | Both validate side, price, status OPEN, and betting window. |
| Cancel order | `cancelOrder(duelKey, marketKind, orderId)` | `cancel_order(order_id, side, price)` | Maker-only cancellation of active remainder. |
| Claim settlement | `claim(duelKey, marketKind)` | `claim()` | Resolved = winner payout less fee; Cancelled = refund locked stake. |
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
| EVM | `DuelOutcomeOracle.cancelDuel` | `REPORTER_ROLE` |
| EVM | `DuelOutcomeOracle.reportResult` | `REPORTER_ROLE` |
| EVM | `GoldClob.createMarketForDuel` | `MARKET_OPERATOR_ROLE` |
| EVM | `GoldClob.setOracle` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setTreasury` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setMarketMaker` | `DEFAULT_ADMIN_ROLE` |
| EVM | `GoldClob.setFeeConfig` | `DEFAULT_ADMIN_ROLE` |
| SVM | `fight_oracle::initialize_oracle` | upgrade-authority + bootstrap authority check |
| SVM | `fight_oracle::update_oracle_config` | oracle config `authority` signer |
| SVM | `fight_oracle::upsert_duel` | oracle config `reporter` signer |
| SVM | `fight_oracle::cancel_duel` | oracle config `reporter` signer |
| SVM | `fight_oracle::report_result` | oracle config `reporter` signer |
| SVM | `gold_clob_market::initialize_config` | upgrade-authority + bootstrap authority check |
| SVM | `gold_clob_market::update_config` | market config `authority` signer |
| SVM | `gold_clob_market::initialize_market` | config `authority` or `market_operator` signer |
