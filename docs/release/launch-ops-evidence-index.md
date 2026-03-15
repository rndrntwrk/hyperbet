# Launch Ops Evidence Index

This index ties Gates `14A`, `19`, `20`, `23`, and `24` to concrete repo
artifacts and notes what still requires live environment evidence before final
release signoff.

## Gate 14A: Staged Live Proof

| Surface | Path | Status |
|---|---|---|
| Proof driver | `scripts/staged-live-proof.ts` | Merged with `solana`, `bsc`, and `avax` targets. |
| Manual workflow | `.github/workflows/staged-live-proof.yml` | Supports `target=avax`. |
| Operator runbook | `docs/runbooks/staged-live-proof.md` | Updated for AVAX read-only, canary, and env-audit flow. |
| AVAX canary entrypoint | `packages/hyperbet-avax/keeper/src/staged-proof-avax.ts` | Added; mirrors BSC canary shape. |
| Expected artifact bundle | `.ci-artifacts/staged-live-proof/{summary.json,verify-chains.json,solana/*,bsc/*,avax/*}` | Pending a real staged execution with staging secrets. |

## Gate 19: AVAX Canonicalization And Runtime Rails

| Surface | Path | Status |
|---|---|---|
| Shared registry schema | `packages/hyperbet-chain-registry/src/index.ts` | Governance-aware AVAX metadata fields added. |
| Shared manifest | `packages/hyperbet-deployments/contracts.json` | New governance fields present for all EVM chains. |
| AVAX package manifest | `packages/hyperbet-avax/deployments/contracts.json` | Governance fields present; production values still blank. |
| Env/runtime audit | `scripts/ci-env-audit.ts` | AVAX staging app audit now expects real staging values. |
| AVAX deploy preflight | `packages/hyperbet-avax/scripts/preflight-contract-deploy.ts` | Requires explicit governance env on mainnet deploys. |
| AVAX deploy workflows | `.github/workflows/deploy-avax-pages.yml`, `.github/workflows/deploy-avax-keeper.yml` | Repo-backed staging and production rails exist. |

Canonical AVAX mainnet contract values are still pending committed deployment
evidence. Final Gate `19` signoff stays blocked until those values are written
into the shared registry and manifest.

## Gate 20: Governance And Emergency Controls

| Surface | Path | Status |
|---|---|---|
| Oracle pause and role separation | `packages/evm-contracts/contracts/DuelOutcomeOracle.sol` | Added pauser role plus distinct reporter/finalizer/challenger surfaces. |
| Market pause controls | `packages/evm-contracts/contracts/GoldClob.sol` | Added pause surfaces for market creation and order placement. |
| Deploy wiring | `packages/evm-contracts/scripts/deploy.ts`, `packages/evm-contracts/scripts/deploy-duel-oracle.ts` | Writes timelock/multisig/emergency metadata into receipts and manifests. |
| Hardhat tests | `packages/evm-contracts/test/DuelOutcomeOracle.ts`, `packages/evm-contracts/test/GoldClob.ts` | Covers pause gating and role rotation. |
| Runbooks | `docs/runbooks/prediction-market-governance-and-emergency-controls.md`, `docs/runbooks/signer-policy-and-key-rotation.md` | Added operator evidence and signer policy guidance. |

Production ownership-transfer tx hashes and final role-assignment receipts are
still pending live deploy execution.

## Gate 23: Launch Evidence Packaging

| Surface | Path | Status |
|---|---|---|
| Release prep summary | `docs/prediction-market-release-prep.md` | Updated reviewer-facing status for AVAX launch plumbing. |
| Release memo | `docs/release/release-memo-template.md` | Converted into a candidate-ready memo scaffold with linked evidence. |
| Audit checklist | `docs/release/external-audit-package-checklist.md` | Converted into a concrete handoff checklist. |
| Deploy guide | `docs/hyperbet-production-deploy.md` | AVAX staging/prod workflow and proof expectations documented. |
| Runbook index | `docs/runbooks/README.md` | Links governance, signer, and staged-proof runbooks. |

## Gate 24: Audit Handoff Package

| Surface | Path | Status |
|---|---|---|
| ABI freeze bundle | `docs/release/abi/gold_clob.abi.json`, `docs/release/abi/duel_outcome_oracle.abi.json` | Must match the committed EVM contract surfaces. |
| Freeze manifest | `docs/release/manifests/rc-2026-03-audit-handoff-freeze.json` | Candidate freeze file; regenerate at final RC cut. |
| Existing evidence index | `docs/release/exploit-test-evidence-index.md` | Carries exploit and scenario evidence expectations. |
| Engineer inputs | `docs/release/issues/engineer-1-evm-protocol-safety.md`, `docs/release/issues/engineer-3-integration-parity.md`, `docs/release/issues/engineer-4-mm-durability.md` | Final audit bundle still depends on these lanes' artifacts. |

## Remaining Blocking Evidence

- committed AVAX mainnet canonical addresses from deployment evidence
- staged-proof read-only and canary artifacts for AVAX
- production ownership-transfer and role-assignment tx hashes
- final freeze manifest regenerated at the actual release-candidate commit
