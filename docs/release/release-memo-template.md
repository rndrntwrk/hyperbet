# Release Memo: RC Audit Handoff Candidate

This memo is the candidate-ready release summary for the prediction-market
launch package as of March 13, 2026. It is intentionally written against
concrete repo artifacts instead of blank placeholders.

## Release Candidate

- Candidate label: `rc-2026-03-audit-handoff`
- Freeze manifest: [manifests/rc-2026-03-audit-handoff-freeze.json](manifests/rc-2026-03-audit-handoff-freeze.json)
- Release prep summary: [../prediction-market-release-prep.md](../prediction-market-release-prep.md)
- Launch-ops evidence index: [launch-ops-evidence-index.md](launch-ops-evidence-index.md)
- Release owner: fill at RC freeze

## Launch Scope

- Launch chains: Solana, BSC, AVAX
- Current constraint: AVAX production rollout remains blocked until canonical
  registry values and staged-proof artifacts are attached.
- Required evidence gates for this lane: `14A`, `19`, `20`, `23`, `24`

## Gate Summary

- Gate `14A`: proof rail is implemented in
  [`scripts/staged-live-proof.ts`](../../scripts/staged-live-proof.ts) with
  workflow support in
  [../../.github/workflows/staged-live-proof.yml](../../.github/workflows/staged-live-proof.yml).
  Real staged artifacts are still pending.
- Gate `19`: AVAX runtime/deploy plumbing is wired through the shared registry,
  manifests, deploy preflight, env audit, and AVAX deploy workflows. Canonical
  mainnet addresses are still pending committed deployment evidence.
- Gate `20`: EVM governance and emergency controls are implemented in
  [../../packages/evm-contracts/contracts/DuelOutcomeOracle.sol](../../packages/evm-contracts/contracts/DuelOutcomeOracle.sol)
  and
  [../../packages/evm-contracts/contracts/GoldClob.sol](../../packages/evm-contracts/contracts/GoldClob.sol),
  with operator guidance in
  [../runbooks/prediction-market-governance-and-emergency-controls.md](../runbooks/prediction-market-governance-and-emergency-controls.md)
  and
  [../runbooks/signer-policy-and-key-rotation.md](../runbooks/signer-policy-and-key-rotation.md).
- Gate `23`: release-facing deploy, runbook, memo, and checklist docs are now
  linked and candidate-ready.
- Gate `24`: ABI freeze files and the audit package scaffold exist, but final
  handoff still depends on Engineer `1`, `3`, and `4` artifacts plus the live
  Gate `14A` bundle.

## Evidence Links

- Deploy guide: [../hyperbet-production-deploy.md](../hyperbet-production-deploy.md)
- Staged proof runbook: [../runbooks/staged-live-proof.md](../runbooks/staged-live-proof.md)
- Governance runbook:
  [../runbooks/prediction-market-governance-and-emergency-controls.md](../runbooks/prediction-market-governance-and-emergency-controls.md)
- Signer rotation runbook:
  [../runbooks/signer-policy-and-key-rotation.md](../runbooks/signer-policy-and-key-rotation.md)
- Audit checklist: [external-audit-package-checklist.md](external-audit-package-checklist.md)
- Existing exploit/test evidence index:
  [exploit-test-evidence-index.md](exploit-test-evidence-index.md)

## Launch Decision Snapshot

- Current decision: not ready for unrestricted real-funds launch
- Blocking items:
  - commit canonical AVAX mainnet registry values from deployment evidence
  - capture AVAX staged read-only and canary artifacts
  - capture production timelock/multisig/emergency ownership transfer evidence
  - merge final audit outputs from Engineers `1`, `3`, and `4`
- Accepted residual-risk discussion can begin only after the blockers above are
  closed and the freeze manifest is regenerated at the RC commit.
