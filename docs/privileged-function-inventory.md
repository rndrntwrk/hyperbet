# Privileged Function Inventory: EVM + SVM Prediction-Market Surfaces

## EVM

### `DuelOutcomeOracle.sol`
| Function | Who can call | Risk tier | Emergency? |
|---|---|---|---|
| `setReporter` | Governance controller (multisig-owned timelock executor) | High | No |
| `emergencySetReporter` | `DEFAULT_ADMIN_ROLE` multisig owner | Critical | Yes |
| `setGovernanceController` | `DEFAULT_ADMIN_ROLE` multisig owner | Critical | No |
| `upsertDuel` / `reportResult` / `cancelDuel` | `REPORTER_ROLE` | High (market settlement critical path) | `cancelDuel` may be used in emergency |

### `GoldClob.sol`
| Function | Who can call | Risk tier | Emergency? |
|---|---|---|---|
| `setOracle` | Governance controller | Critical | No |
| `setTreasury` | Governance controller | High | No |
| `setMarketMaker` | Governance controller | High | No |
| `setFeeConfig` | Governance controller | High | No |
| `emergencySetOracle` | `DEFAULT_ADMIN_ROLE` multisig owner | Critical | Yes |
| `emergencySetTreasury` | `DEFAULT_ADMIN_ROLE` multisig owner | High | Yes |
| `emergencySetMarketMaker` | `DEFAULT_ADMIN_ROLE` multisig owner | High | Yes |
| `emergencySetFeeConfig` | `DEFAULT_ADMIN_ROLE` multisig owner | High | Yes |
| `setGovernanceController` | `DEFAULT_ADMIN_ROLE` multisig owner | Critical | No |
| `createMarketForDuel` | `MARKET_OPERATOR_ROLE` | Medium | No |

## SVM (Anchor)

### `fight_oracle`
| Instruction | Who can call | Risk tier | Emergency? |
|---|---|---|---|
| `initialize_oracle` | Upgrade authority (or bootstrap authority when unset) | Critical | No |
| `update_oracle_config` | `oracle_config.authority` signer | Critical | No |
| `upsert_duel` / `report_result` | `oracle_config.reporter` signer | High | No |
| `cancel_duel` | `oracle_config.reporter` signer | High | Yes |

### `gold_clob_market`
| Instruction | Who can call | Risk tier | Emergency? |
|---|---|---|---|
| `initialize_config` | Upgrade authority (or bootstrap authority when unset) | Critical | No |
| `update_config` | `config.authority` signer | Critical | No |
| `initialize_market` | `config.authority` or `config.market_operator` signer | High | No |
| `sync_market_from_duel` | Any caller (state transition constrained by duel account) | Medium | No |
| `cancel_order` | Order maker | Medium | Yes (self-protective unwind) |
| `claim` | User with balance | Medium | Yes |
