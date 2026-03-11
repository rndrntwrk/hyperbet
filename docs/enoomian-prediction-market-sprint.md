# Enoomian Prediction Market Sprint

This is the living gate tracker for the `enoomian/prediction-market-sprint-base` branch.

Update this document every time the sprint base branch is pushed. Each update should record:

1. The new sprint base commit.
2. Which gate branch merged into the base.
3. The targeted verification that was run.
4. The remaining risk or next gate.

Parallel gate handoff documents for independently executable remaining gates live in:

- `docs/enoomian-gates/README.md`
- `docs/enoomian-gates/gate-06-frontend-settlement.md`
- `docs/enoomian-gates/gate-07-solana-bot-execution.md`
- `docs/enoomian-gates/gate-08-solana-sim-backend.md`

## Sprint Base

- Base branch: `enoomian/prediction-market-sprint-base`
- Latest recorded gate merged into base: `dc05370`
- Last updated: `2026-03-11`
- Active gate branch: `enoomian/pm-06-frontend-settlement`

## Gate Status

| Gate | Branch | Status | Merged To Base | Result |
| --- | --- | --- | --- | --- |
| 01 | `enoomian/pm-01-evm-sim-stability` | Complete | Yes | Async simulation runs, persisted scenario history, scenario CLI, deterministic degraded `ScenarioResult` output for heavy presets |
| 02 | `enoomian/pm-02-evm-scenario-gates` | Complete | Yes | Explicit gate-family catalog, scenario-specific policy evaluation, fresh-baseline scenario runs, and canonical/matrix verification coverage |
| 03 | `enoomian/pm-03-mm-risk-engine` | Complete | Yes | Shared quote sizing, gross-exposure and imbalance caps, and keeper quote refresh decisions now come from `@hyperbet/mm-core` |
| 04 | `enoomian/pm-04-keeper-health-recovery` | Complete | Yes | Keeper bots now persist market health/recovery snapshots and all three keeper services expose merged bot health via `/status` and `/api/keeper/bot-health` |
| 05 | `enoomian/pm-05-runtime-parity` | Complete | Yes | External bot and EVM keepers now share chain-registry runtime assembly, quote refresh behavior, and direct local quote lifecycle smokes for BSC and AVAX |
| 06 | `enoomian/pm-06-frontend-settlement` | Pending | No | Make the frontend lifecycle and claim handling fully canonical on normalized market state |
| 07 | `enoomian/pm-07-solana-bot-execution` | Pending | No | Finish real Solana execution in the external market-maker bot |
| 08 | `enoomian/pm-08-solana-sim-backend` | Pending | No | Build validator-backed Solana scenario execution |
| 09 | `enoomian/pm-09-solana-scenario-gates` | Pending | No | Add Solana exploit families and deterministic gate coverage |
| 10 | `enoomian/pm-10-cross-chain-e2e` | Pending | No | Stabilize create -> seed -> trade -> lock -> resolve -> claim across Solana, BSC, and AVAX |
| 11 | `enoomian/pm-11-ci-ops` | Pending | No | Wire gates into CI, add env safety checks, add-chain proof, and runbooks |

## Gate Results

### Gate 01

- Branch: `enoomian/pm-01-evm-sim-stability`
- Base commit after merge: `5834cec`
- Commit: `5834cec` `evm-sim: stabilize scenario runner and CLI`
- Status: complete and merged into sprint base

Delivered:

- Background scenario runs instead of request-blocking execution.
- Scenario CLI with `list`, `latest`, `history`, and `run`.
- Persisted run and result history outside the repo.
- Per-run stage tracking, including per-agent tick stages.
- Deterministic degraded `ScenarioResult` output for overloaded scenarios.
- Reduced scenario hot-path load for heavy presets.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun run --cwd packages/simulation-dashboard scenario run attack-gauntlet --seed=gauntlet-seed-1`
- `bun run --cwd packages/simulation-dashboard scenario run full-chaos --seed=chaos-seed-1`

Known remaining risk:

- Heavy scenarios are now deterministic and diagnosable, but they still degrade on timeout paths instead of passing as exploit gates.
- `ScenarioResult` can still be generated from fallback state when final state capture times out.
- Gate 02 needs to turn these degraded completions into explicit scenario-family gates with fixed expected outcomes and stronger assertions.

### Gate 02

- Branch: `enoomian/pm-02-evm-scenario-gates`
- Base commit after merge: `cb92a52`
- Commit: `cb92a52` `evm-sim: add scenario gates and deterministic fresh runs`
- Status: complete and merged into sprint base

Delivered:

- Added explicit gate scenario catalog with ids, families, canonical seeds, matrix seeds, runtime profiles, and per-scenario gate policy.
- Added scenario policy evaluation on top of shared mitigation gates so stale-signal, stale-oracle, close-window, inventory-poisoning, sandwich, frontrun/backrun, wash, cancel-replace, order-flood, arbitrage, and claim/refund scenarios each have deterministic pass/fail semantics.
- Expanded the simulation CLI with `gates`, `canonical`, `matrix`, `suite`, and `--fresh`, and made CLI exit status depend on `result.passed`, not only run completion.
- Hardened the sim runner with staged baseline restore/rebuild, awaited Anvil shutdown, fresh-baseline scenario mode, and more fault-tolerant settlement/claim cleanup.
- Tuned heavy canonical scenarios down to CI-grade tick budgets while keeping the higher-pressure behavior in matrix and diagnostic runs.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun test packages/simulation-dashboard/src/scenario-evaluator.test.ts`
- Fresh canonical gate runs passed for:
  `stale-signal-sniping`, `stale-oracle-sniping`, `close-window-race`, `whale-impact`, `mev-extraction`, `sandwich-attack`, `wash-trading`, `arbitrage-hunt`, `cancel-replace-griefing`, `stress-test`, `claim-refund-abuse`
- Fresh matrix runs passed for:
  `sandwich-attack` (`sandwich-seed-1/2/3`),
  `stale-oracle-sniping` (`stale-oracle-seed-1/2/3`),
  `whale-impact` (`inventory-poisoning-seed-1/2/3`),
  `stress-test` (`order-flood-seed-1/2/3`)

Known remaining risk:

- The fastest snapshot/revert path is still less reliable than fresh-baseline mode for long multi-scenario runs, so fresh rebuilds are the current verification default for exploit gates.
- Scenario history intentionally retains older degraded runs, so operators need to read the latest run for current gate truth.
- Gate 03 should now focus on extending `@hyperbet/mm-core` from pricing into full size/risk planning and then feed that into keepers and the external bot.

### Gate 03

- Branch: `enoomian/pm-03-mm-risk-engine`
- Base commit after merge: `d4323e4`
- Commit: `d4323e4` `mm-core: share quote sizing and refresh policy with keepers`
- Status: complete and merged into sprint base

Delivered:

- Extended `@hyperbet/mm-core` with explicit gross-exposure limits, side-imbalance caps, toxicity-driven size reduction, reduce-only state, and centralized quote refresh decisions.
- Added shared `evaluateQuoteDecision` flow so keeper bots no longer open-code price-only refresh and stale replacement logic.
- Switched Solana, BSC, and AVAX keeper-managed CLOB seeding from fixed-size perpetual seed orders to shared target sizing from `buildQuotePlan`.
- Added unit coverage for per-market notional caps, reduce-only imbalance behavior, size-refresh behavior, and refresh-window keep behavior.

Targeted verification:

- `bun test` in `packages/hyperbet-mm-core`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-solana/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`

Known remaining risk:

- Keeper quote contexts still feed placeholder freshness timestamps into the shared risk engine, so stale-stream / stale-oracle / stale-rpc halts are structurally available but not yet backed by real keeper health telemetry.
- Gross exposure and imbalance policy are now centralized, but keeper `/status` does not yet expose the resulting per-market health model for operators.
- Gate 04 should focus on surfacing that health state and adding restart/recovery behavior around missed sync, stale RPC, partial claim, and restart-with-open-orders.

### Gate 04

- Branch: `enoomian/pm-04-keeper-health-recovery`
- Base commit after merge: `79d0101`
- Commit: `79d0101` `keeper: add health and recovery surfaces`
- Status: complete and merged into sprint base

Delivered:

- Added shared keeper market-health and recovery snapshot types to `@hyperbet/mm-core`, plus merge helpers for lifecycle records and keeper health.
- Extended Solana, BSC, and AVAX keeper bots to persist restart/recovery state, per-market quote health, stream/oracle/RPC freshness timestamps, and settled-market retention snapshots.
- Added startup restart reconciliation detection for prior open-order state and serialized bot health snapshots so operators can inspect recovery state even when the bot is disabled.
- Updated all three keeper services to load bot health snapshots, merge them into normalized prediction-market status output, and expose a dedicated `/api/keeper/bot-health` endpoint.
- Added mm-core unit coverage for lifecycle-to-health merging so the status merge path is tested independently of live keeper state.

Targeted verification:

- `bun test` in `packages/hyperbet-mm-core`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-solana/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`
- `curl -s http://127.0.0.1:5611/status`
- `curl -s http://127.0.0.1:5611/api/keeper/bot-health`
- `curl -s http://127.0.0.1:5612/status`
- `curl -s http://127.0.0.1:5612/api/keeper/bot-health`
- `curl -s http://127.0.0.1:5613/status`
- `curl -s http://127.0.0.1:5613/api/keeper/bot-health`

Known remaining risk:

- Keeper health is now visible and durable, but the external market-maker bot and EVM keeper runtimes still diverge in runtime assembly, env handling, and refresh/recovery behavior.
- `predictionMarkets.chains[].health` depends on live lifecycle records existing in the current keeper snapshot, so the merge path is covered by tests while idle `/status` responses can still show an empty `chains` array.
- Gate 05 should align the external bot and EVM keepers on the same chain-registry-driven runtime selection, fair-value inputs, halt logic, and refresh rules.

### Gate 05

- Branch: `enoomian/pm-05-runtime-parity`
- Base commit after merge: `dc05370`
- Commits:
  - `8928897` `runtime: align evm resolver and quote refresh`
  - `dc05370` `runtime: add evm quote lifecycle smoke coverage`
- Status: complete and merged into sprint base

Delivered:

- Moved the external market-maker bot and `verify-chains` onto shared chain-registry runtime resolution so BSC, Base, and AVAX use the same RPC/address/env selection path as the rest of the stack.
- Switched the external bot onto shared quote refresh behavior and added explicit per-chain nonce management for EVM write paths, fixing local same-cycle quote placement on real chains.
- Updated BSC and AVAX keeper bots and services to derive enabled EVM runtimes from chain-registry data plus `EVM_KEEPER_CHAINS`, instead of package-local hardcoded chain lists.
- Added direct runtime smoke commands in `packages/market-maker-bot` that deploy local oracle/CLOB contracts, run quote -> take -> lock -> resolve -> claim, and verify filled-position cleanup without depending on the frontend shell.
- Extended the bot test harness to cover the new runtime nonce path and refresh-window behavior.

Targeted verification:

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test` in `packages/market-maker-bot`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-bsc/keeper`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/hyperbet-avax/keeper`
- `bun run smoke:runtime:bsc -- --rpc-url http://127.0.0.1:18545` in `packages/market-maker-bot`
- `bun run smoke:runtime:avax -- --rpc-url http://127.0.0.1:18545` in `packages/market-maker-bot`

Known remaining risk:

- The BSC and AVAX app shells still have UI-level drift relative to the shared canonical lifecycle panels, so frontend claim/settlement parity remains open for Gate 06 and full cross-chain product reliability remains open for Gate 10.
- The direct runtime smokes currently log a benign cancel failure when the bot tries to cancel an order that was already fully filled before lock; the tracked-order state still clears correctly, but the noisy log path should eventually be tightened.
- Solana execution in the external bot is still incomplete, so runtime parity is only closed for the EVM side of the external market maker.

## Update Template

Copy this block when a new gate is merged into the sprint base.

```md
### Gate XX

- Branch: `enoomian/pm-XX-...`
- Base commit after merge: `<sha>`
- Commit: `<sha>` `<message>`
- Status: complete and merged into sprint base

Delivered:

- ...

Targeted verification:

- `...`

Known remaining risk:

- ...
```
