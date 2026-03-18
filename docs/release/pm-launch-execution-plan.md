# PM Launch Execution Plan

> **TL;DR:** Three-phase plan. Phase 0: get PM gates true by closing AVAX canonicalization, governance deployment, and audit packet (branch: `release/pm-gates-closeout`). Phase 1: harden AMM on frozen PM base (branch: `feature/pm-amm-hardening-v1`). Phase 2: integrate AMM with PM stack (branch: `feature/pm-amm-integration-v1`). PR #19 is excluded from the launch-critical merge train.

---

## Branch Topology

```
main
  └── develop
        └── enoomian/pm16-17-20-21 (convergence, PR #27 → develop)
              └── release/pm-gates-closeout (Phase 0)
                    ├── feature/pm-amm-hardening-v1 (Phase 1, after Phase 0 merges)
                    └── feature/pm-amm-integration-v1 (Phase 2, after Phase 1 merges)
```

**PR #19 (`feat/amm-swap-fees`)** stays open as reference. Do NOT merge into any launch-critical branch.

---

## Phase 0 — Get PM Gates True

**Branch:** `release/pm-gates-closeout`
**Parent:** `enoomian/pm16-17-20-21` (after PR #27 merges to develop)
**Goal:** Close all remaining PM gates so the branch is audit-handoff ready.

### WS 0.1 — AVAX Canonicalization and Proof Gating

- [ ] Populate canonical AVAX deployment truth in `packages/hyperbet-chain-registry/src/index.ts`
  - [ ] `duelOracleAddress`
  - [ ] `goldClobAddress`
  - [ ] `adminAddress`
  - [ ] `marketOperatorAddress`
  - [ ] `treasuryAddress`
  - [ ] `marketMakerAddress`
  - [ ] `reporterAddress`
  - [ ] `finalizerAddress`
  - [ ] `challengerAddress`
  - [ ] `timelockAddress`
  - [ ] `multisigAddress`
  - [ ] `emergencyCouncilAddress`
  - [ ] `goldTokenAddress`
- [ ] Attach Fuji deployment evidence (tx hashes, explorer links)
- [ ] Attach mainnet deployment evidence
- [ ] Attach staged-proof artifact bundles
- [ ] Re-enable AVAX as fully promoted in CI cross-chain lanes
- [ ] Update `docs/release/prediction-market-launch-freeze-tracker.md` Gate 6

**Acceptance:** Gate 6 green. AVAX registry values non-blank. Cross-chain docs no longer say "pending canonical proof."

### WS 0.2 — Governance Deployment and Activation

- [ ] Deploy `TimelockController` on BSC
- [ ] Deploy `TimelockController` on Base
- [ ] Deploy `TimelockController` on AVAX
- [ ] Deploy Safe multisig on BSC (2-of-3 or 3-of-5)
- [ ] Deploy Safe multisig on Base
- [ ] Deploy Safe multisig on AVAX
- [ ] Deploy v3 PM contracts via CREATE2 with timelock as admin on BSC
- [ ] Deploy v3 PM contracts via CREATE2 with timelock as admin on Base
- [ ] Deploy v3 PM contracts via CREATE2 with timelock as admin on AVAX
- [ ] Verify CREATE2 addresses are identical across all 3 chains
- [ ] Transfer Solana upgrade authority to Squads multisig
- [ ] Execute `freeze_oracle_config` on Solana
- [ ] Execute `freeze_config` on Solana
- [ ] Record all governance tx hashes in chain-registry
- [ ] Verify role assignments via block explorer on all chains
- [ ] Update chain-registry `deploymentVersion` to `"v3"` for all mainnets

**Acceptance:** Timelock/multisig live on all EVM chains. Solana authority transferred. Freeze transactions completed. Explorer verification confirms constructor args and role wiring.

### WS 0.3 — Gate 22 Audit Packet and Doc-Truth Alignment

- [ ] Finalize `docs/release/gate-22-required-check-contract.md`
- [ ] Attach freeze manifest with final RC commit hash
- [ ] Attach ABI freeze files (verify against deployed bytecode)
- [ ] Attach staged-proof evidence bundles (read-only + canary-write)
- [ ] Attach governance assignment tx hashes
- [ ] Finalize residual-risk register (remove stale tracking items already resolved)
- [ ] Finalize engineer evidence artifacts
- [ ] Finalize findings ledger with accepted residual risks
- [ ] Close `docs/release/external-audit-package-checklist.md` — all items checked
- [ ] Verify no release doc contradicts implementation or CI

**Acceptance:** Gate 22 green. Every release-facing claim links to proof artifact, test, or tx hash.

### WS 0.4 — Final PM-Gates Signoff

- [ ] Run full verification flow: `forge test --fuzz-runs 512` + `hardhat test` + deployment tests + TS checks
- [ ] Run staged live proof in read-only mode
- [ ] Run staged live proof in canary-write mode
- [ ] Confirm Solana/BSC/AVAX E2E lanes passing
- [ ] Confirm Base add-chain smoke passing
- [ ] Tag final audit candidate commit
- [ ] Record RC tag in freeze tracker

**Acceptance:** PM gates are true. Tri-chain launch evidence complete. PM-core ready for external audit.

---

## Phase 1 — PM-AMM Hardening

**Branch:** `feature/pm-amm-hardening-v1`
**Parent:** `release/pm-gates-closeout` (after Phase 0 merges)
**Goal:** Bring AMM code to PM-core quality bar. Do NOT reopen PM16/17/20/21 semantics.

### WS 1.1 — Branch Surgery

- [ ] Start from merged PM-gates base (NOT from PR #19)
- [ ] Cherry-pick only AMM-specific commits from PR #19:
  - [ ] `packages/evm-contracts/contracts/lvr_amm/LvrMarket.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/Router.sol`
  - [ ] `packages/evm-contracts/contracts/lvr_amm/lib/*.sol`
  - [ ] `packages/hyperbet-solana/anchor/programs/lvr_amm/`
- [ ] Exclude unrelated dashboard/frontend/shared-runtime/keeper churn
- [ ] Verify PM-core contracts are unchanged after cherry-pick

**Acceptance:** AMM diff is AMM-focused and reviewable. No accidental reintroduction of superseded work.

### WS 1.2 — EVM AMM Remediation

- [ ] Add Router market allowlist; enforce in all callbacks
- [ ] Validate callback asset addresses against market metadata
- [ ] Put `setFeeConfig` behind `onlyRole(DEFAULT_ADMIN_ROLE)` with fee caps
- [ ] Remove or redesign standalone AMM dispute/settlement path — cannot bypass PM-core finality
- [ ] Fix dynamic price read/execution parity (time-decayed liquidity in reads, not just swaps)
- [ ] Replace `f64` floating-point math if present
- [ ] Add `nonReentrant` to Router
- [ ] Add slippage protection (`minAmountOut`) to swap functions
- [ ] Add oracle staleness checks
- [ ] Add exploit regression tests:
  - [ ] Malicious callback caller
  - [ ] Unauthorized config change
  - [ ] Dispute bypass
  - [ ] Price/reporting divergence

**Acceptance:** Non-market callers always revert. Unauthorized config always reverts. AMM settlement cannot bypass PM-core truth. Price views match execution.

### WS 1.3 — Solana AMM Remediation

- [ ] Replace per-market caller-supplied `fee_bps` and `treasury` with protocol-owned Config PDA
- [ ] Remove unchecked treasury ATA fee routing; enforce canonical treasury ATA constraints
- [ ] Replace `admin_state.admin` settlement with PM-core resolution model or thin oracle adapter
- [ ] Add freeze/pause parity aligned with PM-core (`freeze_config`, `set_paused`)
- [ ] Replace all `f64` floating-point math with fixed-point integer arithmetic
- [ ] Add negative tests:
  - [ ] Wrong ATA
  - [ ] Wrong owner
  - [ ] Wrong mint
  - [ ] Unauthorized config
  - [ ] Unauthorized settlement

**Acceptance:** Fee routing cannot be redirected. Unauthorized settlement always fails. AMM config matches PM-core posture.

### WS 1.4 — AMM Assurance Package

- [ ] Build independent AMM reference model
- [ ] Add invariant suites:
  - [ ] Accounting conservation
  - [ ] Fee conservation
  - [ ] Reserve non-negativity
  - [ ] Complement pricing
  - [ ] Terminal redemption
  - [ ] Read/execution parity
- [ ] Add edge-case and fuzz coverage:
  - [ ] Near expiry
  - [ ] Low liquidity
  - [ ] Large orders
  - [ ] Fee edge cases
- [ ] Document allowed parameter ranges and launch-eligible market classes

**Acceptance:** AMM passes invariants on every commit. Value-moving paths have property tests. Parameterization memo exists.

---

## Phase 2 — PM-AMM Integration

**Branch:** `feature/pm-amm-integration-v1`
**Parent:** `feature/pm-amm-hardening-v1` (after Phase 1 merges)
**Goal:** Integrate hardened AMM with the existing prediction-market stack.

### WS 2.1 — Shared Resolution and Lifecycle Integration

- [ ] AMM markets resolve off same truth model as PM-core (reporter/challenger/finalizer)
- [ ] Require explicit market-level resolution metadata (source, end date, edge cases, dispute flow)
- [ ] AMM terminal states map to claim/refund semantics
- [ ] No standalone AMM resolution path remains outside PM-core truth model

### WS 2.2 — Market-Type Integration Strategy

- [ ] Launch PM-AMM as separate market type (not hidden fallback inside GoldClob)
- [ ] Keep CLOB and AMM routing explicit in app, indexer, analytics
- [ ] Add feature flags for per-market AMM enable/disable
- [ ] GoldClob PM gates stay true and unchanged

### WS 2.3 — Offchain Orderflow and Runtime Discipline

- [ ] Keep PM-AMM bot/keeper components non-trust-bearing
- [ ] Add order/quote TTLs, replay protection, restart behavior
- [ ] Document what is convenience infra vs safety-critical
- [ ] Replay/restart tests pass

### WS 2.4 — Tri-Chain Deployment Integration

- [ ] Extend CREATE2 and registry discipline to AMM EVM deployments on BSC/Base/AVAX
- [ ] Add Solana deployment manifests and authority records for AMM program
- [ ] Add chain-registry entries for AMM
- [ ] Add explorer verification and staged-proof checks for AMM

### WS 2.5 — External Audit and Launch Controls

- [ ] Audit PM-core first (separate engagement)
- [ ] Audit PM-AMM second (separate scoped engagement)
- [ ] Add monitoring and alerting
- [ ] Add bug bounty coverage
- [ ] Add canary liquidity limits before AMM mainnet scale
- [ ] Document kill-switch procedures

**Acceptance:** Zero open critical/high on PM-AMM. PM-core unchanged except auditor-reviewed fixes. Canary rollout limits live.

---

## Forbidden Actions

- Do NOT merge PR #19 into any launch-critical branch
- Do NOT reopen PM16/17/20/21 contract semantics for AMM compatibility
- Do NOT widen the trust-bearing surface by merging keeper/dashboard churn into PM-core
- Do NOT deploy AMM contracts without matching CREATE2/registry/governance discipline
