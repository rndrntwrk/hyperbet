# Enoomian Prediction Market Sprint

This is the living gate tracker for the `enoomian/prediction-market-sprint-base` branch.

Update this document every time the sprint base branch is pushed. Each update should record:

1. The new sprint base commit.
2. Which gate branch merged into the base.
3. The targeted verification that was run.
4. The remaining risk or next gate.

## Sprint Base

- Base branch: `enoomian/prediction-market-sprint-base`
- Latest recorded gate merged into base: `875d1a4`
- Last updated: `2026-03-11`
- Active gate branch: `enoomian/pm-11-ci-ops`

## Gate Status

| Gate | Branch | Status | Merged To Base | Result |
| --- | --- | --- | --- | --- |
| 01 | `enoomian/pm-01-evm-sim-stability` | Complete | Yes | Async simulation runs, persisted scenario history, scenario CLI, deterministic degraded `ScenarioResult` output for heavy presets |
| 02 | `enoomian/pm-02-evm-scenario-gates` | Complete | Yes | Explicit gate-family catalog, scenario-specific policy evaluation, fresh-baseline scenario runs, and canonical/matrix verification coverage |
| 03 | `enoomian/pm-03-mm-risk-engine` | Complete | Yes | Shared quote sizing, gross-exposure and imbalance caps, and keeper quote refresh decisions now come from `@hyperbet/mm-core` |
| 04 | `enoomian/pm-04-keeper-health-recovery` | Complete | Yes | Keeper bots now persist market health/recovery snapshots and all three keeper services expose merged bot health via `/status` and `/api/keeper/bot-health` |
| 05 | `enoomian/pm-05-runtime-parity` | Complete | Yes | External bot and EVM keepers now share chain-registry runtime assembly, quote refresh behavior, and direct local quote lifecycle smokes for BSC and AVAX |
| 06 | `enoomian/pm-06-frontend-settlement` | Complete | Yes | Solana, BSC, and AVAX shells now follow canonical lifecycle and claim state with green focused lifecycle verification |
| 07 | `enoomian/pm-07-solana-bot-execution` | Complete | Yes | External market-maker bot now executes real Solana quote, cancel, refresh, and claim flows with validator-backed smoke coverage |
| 08 | `enoomian/pm-08-solana-sim-backend` | Complete | Yes | Validator-backed Solana proof scenarios now run through the shared scenario backend contract |
| 09 | `enoomian/pm-09-solana-scenario-gates` | Complete | Yes | Validator-backed Solana exploit families now run through deterministic gate scenarios with canonical and matrix verification |
| 10 | `enoomian/pm-10-cross-chain-e2e` | Complete | Yes | Cross-chain local E2E now covers full lifecycle, cancel/refund, and keeper restart recovery across Solana, BSC, and AVAX |
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

### Gate 06

- Branch: `enoomian/pm-06-frontend-settlement`
- Base commit after merge: `0a8af43`
- Commits:
  - `110c9e9` `Implement Gate 06 frontend settlement parity`
  - `9c6fcd1` `frontend: fix shell typecheck and avax e2e setup`
  - `0a8af43` `frontend: keep evm lifecycle claim state live`
- Status: complete and merged into sprint base

Delivered:

- Fixed Solana shell/typecheck drift so the Solana app now resolves the shared `ModelsMarketView` correctly and no longer carries duplicate handler/prop issues in the stream shell.
- Fixed AVAX local E2E harness drift so its validator bootstrap falls back through the same Solana wallet path chain as BSC instead of hard-failing on a missing deployer key.
- Kept the shared EVM lifecycle shell canonical by allowing the EVM panel to trade from normalized lifecycle state without requiring a pre-fetched market existence check.
- Added optimistic EVM wallet-position carry-forward in the shared EVM panel so claimability and visible exposure stay aligned with canonical lifecycle after a confirmed order even when local read refresh lags the write path.
- Kept quick-order UI hidden by default in normal runtime but exposed limit-price controls in E2E mode so the lifecycle shell specs can drive deterministic price entry on BSC and AVAX.

Targeted verification:

- `bun test packages/hyperbet-ui/tests/predictionMarkets.test.ts`
- `bunx tsc --noEmit -p packages/hyperbet-ui/tsconfig.verify.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/app/tsconfig.json`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "solana lifecycle shell|solana predictions place"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm lifecycle shell|evm predictions place"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm lifecycle shell|evm predictions place"` in `packages/hyperbet-avax/app`

Known remaining risk:

- Gate 06 closes focused lifecycle and claim parity, but it does not yet close the full cross-chain product path; restart/recovery, broader shell regressions, and full create -> seed -> trade -> lock -> resolve -> claim reliability remain Gate 10 work.
- The shared EVM panel now uses an optimistic exposure fallback to bridge local read lag after confirmed writes. That behavior is intentional and test-backed, but it should continue to be exercised in Gate 10 so it does not mask a real backend read regression.
- Solana exploit-family coverage is now closed by Gate 09, so the next sprint-critical work moves to Gate 10 cross-chain reliability.

### Gate 07

- Branch: `enoomian/pm-07-solana-bot-execution`
- Base commit after merge: `70e1bd4`
- Commits:
  - `19bb8e6` `market-maker-bot: implement Solana execution runtime`
  - `d0997ae` `tests: add Solana bot smoke coverage`
  - `70e1bd4` `docs: document Solana bot runtime requirements`
- Status: complete and merged into sprint base

Delivered:

- Replaced the external bot's readiness-only Solana path with an Anchor-backed runtime that resolves Solana deployment defaults from `@hyperbet/chain-registry`, loads config PDA state, and disables only Solana when signer, program, or config prerequisites are unusable.
- Added real Solana duel-to-market sync, on-chain order reconciliation, shared mm-core quote planning, refresh-window keep behavior, stale and lifecycle-driven cancellation, resolved claim handling, and richer Solana status/config reporting.
- Added focused Solana unit coverage plus a validator-backed `bun run smoke:runtime:solana` path reused from the local Anchor workspace.
- Documented the Solana signer, program-id, and wallet-config requirements in the market-maker bot package examples and README.

Targeted verification:

- `bun test` in `packages/market-maker-bot`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/market-maker-bot`
- `ANCHOR_TEST_RPC_PORT=18999 ANCHOR_TEST_WS_PORT=19000 ANCHOR_TEST_FAUCET_PORT=19900 bun run smoke:runtime:solana` in `packages/market-maker-bot`

Known remaining risk:

- The validator smoke proves quote placement, fill, resolve, and claim. Stale-order cancellation and lock-triggered cancellation remain primarily covered by unit tests and should be re-exercised in Gate 10 cross-chain E2E.
- Production Solana execution now depends on a funded signer plus live fight-oracle / gold-CLOB deployments and config PDA state, so env validation and operator runbooks remain Gate 11 work.

### Gate 08

- Branch: `enoomian/pm-08-solana-sim-backend`
- Base commit after merge: `e709eac`
- Commits:
  - `8d8ae2a` `simulation-dashboard: add chain-aware scenario metadata`
  - `067ee7a` `simulation-dashboard: add validator-backed Solana scenarios`
  - `e709eac` `simulation-dashboard: harden backend split runtime`
- Status: complete and merged into sprint base

Delivered:

- Added backend selection and shared backend contracts so simulation scenarios can run on EVM or validator-backed Solana without changing the public HTTP surface.
- Added a full Solana backend with validator bootstrapping, program runtime wiring, proof scenario execution, and normalization into the shared `ScenarioResult` contract.
- Added chain-aware scenario run records and unit coverage for backend routing and Solana result normalization.
- Hardened the EVM backend path with managed MM quote refresh behavior, read-provider fallback to the write client, and env-configurable simulation ports for isolated verification runs.

Targeted verification:

- `bunx tsc --noEmit -p tsconfig.json` in `packages/simulation-dashboard`
- `bun test` in `packages/simulation-dashboard`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical solana-happy-path`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical solana-unauthorized-oracle-attack`
- `SIM_API_URL=http://127.0.0.1:3501 node --import tsx src/cli.ts canonical stale-oracle-sniping --fresh`

Known remaining risk:

- The long diagnostic EVM `normal-market` preset still degrades under extended tick counts; Gate 08 closes the backend abstraction and proof path, but not the remaining diagnostic-performance issue.
- Solana proof runs still leave noisy websocket reconnect logs from validator teardown in the long-lived dashboard process; they do not invalidate results, but the cleanup path should be tightened.
- Gate 09 closes the first Solana exploit-family gate set, but Gate 10 still needs to re-exercise those protections in the full cross-chain product flows.

### Gate 09

- Branch: `enoomian/pm-09-solana-scenario-gates`
- Base commit after merge: `20c3e52`
- Commit: `20c3e52` `solana-sim: add validator-backed scenario gates`
- Status: complete and merged into sprint base

Delivered:

- Added six real Solana gate presets on top of the validator-backed backend: stale-resolution-window, lock-race-attempt, cancel-replace-griefing, inventory-poisoning, claim-refund-abuse, and cross-market-validation-abuse.
- Extended the Solana program runtime with duel locking, duel cancellation, order cancellation, and custom result timestamps so validator-backed proof scenarios can drive real lifecycle abuse paths against `fight_oracle` and `gold_clob_market`.
- Replaced the single-path Solana proof runner with scenario-specific scripted flows that hit actual oracle and CLOB rejection paths, including invalid pre-close resolution attempts, post-lock order rejection, same-level cancel/replace churn, repeated refund-claim rejection, and wrong-market remaining-account rejection.
- Extended Solana proof normalization with guard-trip metrics and generalized adversarial-rejection detection so the new gate scenarios land on the shared `ScenarioResult` contract without Solana-only pass/fail logic.
- Verified that persistent-level cancel/replace churn works on the real Solana programs while level-closing cancellation remains a separate protocol concern to revisit under broader E2E/runtime coverage.

Targeted verification:

- `bunx tsc --noEmit -p packages/simulation-dashboard/tsconfig.json`
- `bun test packages/simulation-dashboard`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-stale-resolution-window`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-lock-race-attempt`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-cancel-replace-griefing`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-inventory-poisoning`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-claim-refund-abuse`
- `bun run --cwd packages/simulation-dashboard scenario canonical solana-cross-market-validation-abuse`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-lock-race-attempt`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-inventory-poisoning`
- `bun run --cwd packages/simulation-dashboard scenario matrix solana-cross-market-validation-abuse`

Known remaining risk:

- Solana validator runs still emit noisy websocket reconnect logs during teardown; they do not invalidate results, but the shutdown path is still rough.
- The cancel/replace scenario is currently validated through same-level churn behind a persistent resting quote; broader order-book cancellation patterns still need to be exercised in Gate 10 cross-chain E2E.
- The canonical stale-resolution and claim-refund scenarios have one fixed seed each today. They are deterministic and green, but higher-pressure seed matrices can still be added if Gate 10 uncovers path dependence.

### Gate 10

- Branch: `enoomian/pm-10-cross-chain-e2e`
- Base commit after merge: `875d1a4`
- Commits:
  - `521d074` `e2e: add gate 10 process control and recovery specs`
  - `3984410` `e2e: harden gate 10 recovery paths`
  - `e143181` `runtime: persist lifecycle state and fix claim recovery`
  - `875d1a4` `e2e: close gate 10 cross-chain reliability flows`
- Status: complete and merged into sprint base

Delivered:

- Added deterministic local process-control and recovery wiring for the Solana, BSC, and AVAX E2E stacks so the harness can restart keepers and chain readers inside a live run without production-only restart endpoints.
- Persisted keeper stream-state snapshots across Solana, BSC, and AVAX services so the canonical lifecycle surface can recover duel identity and market refs after restarts instead of falling back to `UNKNOWN`.
- Hardened shared EVM lifecycle and claim recovery by aligning the UI ABI/client expectations with the live `GoldClob` interface and surfacing richer E2E lifecycle debug state in the shared EVM and Solana panels.
- Reworked the cross-chain reliability specs to use fresh isolated markets for restart and cancel/refund flows, which closes the prior false-coupling to already-resolved seeded markets.
- Closed the real product-path assertions for full lifecycle, keeper restart recovery, cancel/refund cleanup, and health-surface parity across Solana, BSC, and AVAX.

Targeted verification:

- `bun test packages/hyperbet-ui/tests/predictionMarkets.test.ts`
- `bunx tsc --noEmit -p packages/hyperbet-ui/tsconfig.verify.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-solana/keeper/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-bsc/keeper/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/app/tsconfig.json`
- `bunx tsc --noEmit -p packages/hyperbet-avax/keeper/tsconfig.json`
- `bash -n packages/hyperbet-solana/app/scripts/run-e2e-local.sh`
- `bash -n packages/hyperbet-bsc/app/scripts/run-e2e-local.sh`
- `bash -n packages/hyperbet-avax/app/scripts/run-e2e-local.sh`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "solana predictions place YES and NO orders, resolve, and claim|solana prediction markets recover after keeper and proxy restarts|solana cancelled duel refunds and clears claim state"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm predictions place YES and NO orders, resolve, and claim|bsc prediction markets recover after keeper and anvil restarts|bsc cancelled prediction markets refund and clear positions"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/market-flows.spec.ts --grep "evm predictions place YES and NO orders, resolve, and claim|avax prediction markets recover after keeper and anvil restarts|avax cancelled prediction markets refund and clear positions"` in `packages/hyperbet-avax/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-solana/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-bsc/app`
- `bash scripts/run-e2e-local.sh tests/e2e/app-tabs-and-apis.spec.ts --grep "keeper backend exposes all app-facing data endpoints"` in `packages/hyperbet-avax/app`

Known remaining risk:

- The BSC and AVAX API smoke now asserts exact duel and contract identity but only enforces `marketRef` as a valid canonical hex32 or `null`; the stricter seeded-key equality is still exercised by the real product E2E flows, but the cold-start API record path remains slightly looser than the full lifecycle path.
- Gate 10 closes local cross-chain reliability, but CI promotion, env/secret safety, add-chain proof for Base, and operator runbooks remain Gate 11 work.
- Solana cancellation is now covered in the product path for fresh isolated markets, but any future protocol changes to order-book cancellation semantics should be re-exercised against these E2E flows, not only the validator scenario suite.

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
