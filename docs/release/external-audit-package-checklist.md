# External Audit Package Checklist

Use this checklist with the candidate memo in
[release-memo-template.md](release-memo-template.md) and the evidence index in
[launch-ops-evidence-index.md](launch-ops-evidence-index.md).

## Scope And Freeze

- [ ] Freeze manifest regenerated and attached:
  [manifests/rc-2026-03-audit-handoff-freeze.json](manifests/rc-2026-03-audit-handoff-freeze.json)
- [x] Launch scope documented in
  [release-memo-template.md](release-memo-template.md)
- [x] Engineer ownership and issue bodies linked in
  [issues/README.md](issues/README.md)
- [ ] Final RC branch and commit recorded at freeze time

## Gate 14A: Staged Live Proof

- [x] Proof driver and workflow linked:
  [../../scripts/staged-live-proof.ts](../../scripts/staged-live-proof.ts),
  [../../.github/workflows/staged-live-proof.yml](../../.github/workflows/staged-live-proof.yml)
- [x] Operator runbook linked:
  [../runbooks/staged-live-proof.md](../runbooks/staged-live-proof.md)
- [ ] Read-only artifact bundle attached from `.ci-artifacts/staged-live-proof`
- [ ] Canary-write artifact bundle attached from `.ci-artifacts/staged-live-proof`
- [ ] AVAX env-audit and `verify-chains` outputs attached

## Gate 19: AVAX Canonicalization And Runtime

- [x] Shared registry schema linked:
  [../../packages/hyperbet-chain-registry/src/index.ts](../../packages/hyperbet-chain-registry/src/index.ts)
- [x] Shared and AVAX manifests linked:
  [../../packages/hyperbet-deployments/contracts.json](../../packages/hyperbet-deployments/contracts.json),
  [../../packages/hyperbet-avax/deployments/contracts.json](../../packages/hyperbet-avax/deployments/contracts.json)
- [x] AVAX deploy workflows linked:
  [../../.github/workflows/deploy-avax-pages.yml](../../.github/workflows/deploy-avax-pages.yml),
  [../../.github/workflows/deploy-avax-keeper.yml](../../.github/workflows/deploy-avax-keeper.yml)
- [ ] Canonical AVAX mainnet addresses committed from deployment evidence
- [ ] Production AVAX runtime smoke attached

## Gate 20: Governance And Emergency Controls

- [x] Oracle governance surface linked:
  [../../packages/evm-contracts/contracts/DuelOutcomeOracle.sol](../../packages/evm-contracts/contracts/DuelOutcomeOracle.sol)
- [x] Market pause surface linked:
  [../../packages/evm-contracts/contracts/GoldClob.sol](../../packages/evm-contracts/contracts/GoldClob.sol)
- [x] Deploy receipts/manifest writers linked:
  [../../packages/evm-contracts/scripts/deploy.ts](../../packages/evm-contracts/scripts/deploy.ts),
  [../../packages/evm-contracts/scripts/deploy-duel-oracle.ts](../../packages/evm-contracts/scripts/deploy-duel-oracle.ts)
- [x] Governance and signer runbooks linked:
  [../runbooks/prediction-market-governance-and-emergency-controls.md](../runbooks/prediction-market-governance-and-emergency-controls.md),
  [../runbooks/signer-policy-and-key-rotation.md](../runbooks/signer-policy-and-key-rotation.md)
- [ ] Production timelock, multisig, emergency, reporter, finalizer, and
  challenger assignment tx hashes attached

## Gate 23: Launch Evidence Package

- [x] Reviewer-facing release prep linked:
  [../prediction-market-release-prep.md](../prediction-market-release-prep.md)
- [x] Deploy guide linked:
  [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md)
- [x] Runbook index linked:
  [../runbooks/README.md](../runbooks/README.md)
- [x] Memo and checklist converted from blank templates into candidate docs

## Gate 24: Audit Handoff Package

- [ ] ABI freeze files refreshed and attached:
  [abi/gold_clob.abi.json](abi/gold_clob.abi.json),
  [abi/duel_outcome_oracle.abi.json](abi/duel_outcome_oracle.abi.json)
- [x] Existing exploit/test evidence index linked:
  [exploit-test-evidence-index.md](exploit-test-evidence-index.md)
- [ ] Engineer `1`, `3`, and `4` artifacts attached
- [ ] Final findings ledger and accepted residual risks attached
