# Prediction Market Release Prep

This document is the reviewer-facing release summary for the prediction-market
sprint.

As of March 13, 2026, this is a phase-3 release-prep artifact:

- release-facing docs and runbooks are linked into a candidate audit package
- AVAX deploy/runtime/proof plumbing is merged into the shared launch rails
- EVM governance and emergency pause controls are implemented and documented
- reviewer inventory, release memo, and audit checklist are assembled
- live staged-proof execution and canonical AVAX mainnet values are still
  outstanding before launch signoff

This document does not declare the sprint release-ready for unrestricted real
funds. It is the reviewer handoff for the sprint base after the deploy/proof
rails, governance controls, and audit-package scaffolding have landed.

## Sprint Summary

Completed work already merged into the sprint base covers:

- deterministic EVM and Solana scenario execution, exploit gates, and shared
  scenario history through the simulation dashboard
- shared market-maker sizing and refresh policy in `@hyperbet/mm-core`
- keeper health, recovery, and operator status visibility across Solana, BSC,
  and AVAX
- runtime parity and validator-backed Solana execution for the external
  market-maker bot
- frontend lifecycle and claim-state parity across Solana, BSC, and AVAX
- cross-chain local E2E coverage and CI / ops hardening through Gate 11
- contract-validation, proof, and security CI promotion through Gate 13
- AVAX staging/runtime/proof plumbing and governance metadata rails for Gates
  19 and 20
- release evidence, governance runbooks, and audit-package scaffolding for
  Gates 23 and 24

Current dependency state:

- Gate 13: complete as contract/security CI promotion
- Gate 14A: proof rail implemented for Solana, BSC, and AVAX; staged
  read-only/canary execution still outstanding
- Gate 19: AVAX production rollout blocked pending canonical registry values
- Gate 20: governance surfaces merged; live ownership-transfer evidence still
  outstanding
- Gate 23 / 24: reviewer docs and audit-package scaffold merged; final handoff
  still depends on live artifacts plus incoming Engineer 1/3/4 evidence

## Reviewer Artifact Inventory

Primary documents:

- [Sprint tracker](enoomian-prediction-market-sprint.md)
- [Five-engineer execution plan](release/five-engineer-execution.md)
- [Engineer instructions](release/engineer-instructions.md)
- [GitHub issue bodies](release/issues/README.md)
- [Production deploy guide](hyperbet-production-deploy.md)
- [Development setup](development-setup.md)
- [Runbook index](runbooks/README.md)
- [Market-maker bot README](../packages/market-maker-bot/README.md)
- [Launch-ops evidence index](release/launch-ops-evidence-index.md)
- [Release memo template](release/release-memo-template.md)
- [External audit package checklist](release/external-audit-package-checklist.md)

Operational and CI surfaces to spot-check:

- [Fast CI workflow](../.github/workflows/ci.yml)
- [Prediction-market gate workflow](../.github/workflows/prediction-market-gates.yml)
- [Staged live proof workflow](../.github/workflows/staged-live-proof.yml)
- `scripts/ci-env-audit.ts`
- `scripts/ci-contracts.ts`
- `scripts/staged-live-proof.ts`
- `packages/simulation-dashboard`
- `packages/market-maker-bot`
- `packages/hyperbet-solana/keeper`
- `packages/hyperbet-bsc/keeper`
- `packages/hyperbet-avax/keeper`

Representative local verification entrypoints already documented elsewhere:

- `bun run dev:doctor`
- `bun run dev:bootstrap`
- `bun run ci:contracts:fast`
- `bun run ci:gate:base`
- `bun run --cwd packages/market-maker-bot smoke:runtime:solana`
- `bun run --cwd packages/simulation-dashboard scenario suite --fresh`

## Merge Checklist For `develop`

- tracked release-facing docs contain no accidental local absolute-path links
- deploy, setup, and runbook wording matches current repo scripts and workflow
  names
- AVAX is described accurately as a launch chain whose production rollout is
  blocked until canonical registry addresses and staged-proof artifacts exist
- CI wording reflects the real required lanes:
  - `Solana Program Build Gate`
  - `EVM Contract Validation`
  - `EVM Contract Proof Gate`
  - `EVM Contract Security Gate`
  - `EVM Exploit Gate`
  - `Solana Exploit Gate`
  - `Base Add-Chain Smoke`
- Gate 14A is described as having a proof rail but not yet complete until a
  real staged run succeeds
- governance, signer-policy, and emergency runbooks are linked from the
  release-facing package
- targeted checks and broader regression for the dependency gates are green
- sprint tracker is updated after the relevant base-branch push
- ready-to-merge synthesis is written without overstating release readiness

## Residual Risk And Blocked Follow-Ups

- AVAX is still not canonicalized for production; the deploy/proof rails are in
  place, but the real mainnet addresses still need to be committed from
  deployment evidence.
- Contract/security CI is now wired into the repo workflows, but local desktop
  verification can still be constrained by toolchain issues such as Hardhat
  compiler download and macOS-specific Foundry crashes.
- Gate 14A staged live proof remains the largest outstanding operator proof
  before claiming full audit-style deployment confidence.
- Production ownership-transfer evidence for timelock, multisig, emergency, and
  role separation is still outstanding.
- Any release-facing summary that omits the AVAX rollout block, remaining live
  proof work, or pending governance receipts would be misleading.
