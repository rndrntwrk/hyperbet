# PR #27 plan execution (local)

Branch: `enoomian/pm16-17-20-21` (synced with `origin/enoomian/pm16-17-20-21`).

## Verification run

- `bun install --frozen-lockfile` — OK
- `forge test --fuzz-runs 512` (`packages/evm-contracts`) — 48 tests passed
- `bun x hardhat test` (`packages/evm-contracts`) — 107 passing (after test fix below)
- Deployment manifest tests — `packages/hyperbet-{avax,bsc,solana,evm}/tests`, `hyperbet-deployments/tests` — OK
- `packages/hyperbet-chain-registry/tests`, `hyperbet-sdk/tests`, `hyperbet-mm-core/tests`, `hyperbet-evm-keeper-core/tests` — OK
- `bun run --cwd packages/hyperbet-ui test` (with `--preload ./tests/setup.ts`) — 86 passed  
  Note: `bun test packages/hyperbet-*/tests/` from repo root pulls `@hyperbet/ui` tests **without** that preload and fails on `document is not defined`; use the package script for UI.
- `bun run --cwd packages/market-maker-bot test` — 66 passed
- `bunx tsc --noEmit` for `hyperbet-solana/app`, `hyperbet-bsc/app`, `hyperbet-avax/app` — OK

## Package pass (summary)

| Area | Delta vs develop | Notes |
|------|------------------|-------|
| `hyperbet-solana` | Large | Programs, IDLs, tests, apps |
| `evm-contracts` | Medium | Oracle/CLOB, Foundry/Hardhat, CREATE2 |
| `hyperbet-bsc` / `hyperbet-avax` | Medium | Keepers, e2e, deployments shims |
| `hyperbet-evm` | Small | Manifest tests |
| `hyperbet-ui` | Small | IDLs, chainConfig, SolanaClobPanel |
| `hyperbet-chain-registry` | Small | Registry + tests |
| `market-maker-bot` | Small | IDL, storage |
| `simulation-dashboard` | Small | Oracle timing |
| `hyperbet-deployments`, `hyperbet-evm-keeper-core` | Tiny | |
| `hyperbet-sdk`, `hyperbet-sdk-py`, `hyperbet-mm-core` | 0 path change in PR diff | Confirmed consumers still typecheck/test (mm-core, sdk tests run) |

## Skills / risk notes

- EVM: PM16/20/21 coverage exercised by `OracleFinality.t.sol`, `ExploitSuite.t.sol`, `GoldClobCanonical.ts`, settlement/fuzz suites.
- Solana: Anchor tests and CI gates per `cross-chain-parity-matrix.md` trace table.
- Docs: Parity matrix TL;DR updated so pause/freeze matches post–mainnet-blocker Solana programs.

## Fixes applied in this workspace

1. **Hardhat** `GoldClobCanonical.ts` — “rejects order cancellation after betting locks”: advance EVM time to `openedAt + 60` before `upsertDuel` to `LOCKED`, matching `BettingWindowActive` guard on oracle.

2. **Docs** `docs/protocol/cross-chain-parity-matrix.md` — TL;DR and new behavior/privileged rows for freeze, pause, and re-init parity (P1).

3. **Solana** [`packages/hyperbet-solana/scripts/init-pm-config.ts`](packages/hyperbet-solana/scripts/init-pm-config.ts) — if oracle or market config already has `configFrozen`, skip `updateOracleConfig` / `updateConfig` so Stage-A / Deploy Testnet v3 reruns do not revert with `ConfigFrozen` after a previous successful freeze.

## GitHub Actions (PR #27)

From `gh pr checks 27` after the review push: core prediction-market and validation jobs **pass** (EVM/Solana proof & exploit gates, cross-chain E2E, app `Validate hyperbet-*`, Pre-PR Ready, Shared Validation).

**Deploy Testnet v3** had failed with `ConfigFrozen` while updating an already-frozen devnet config; fix (3) addresses idempotency. Push the script change and re-run that workflow to confirm.
