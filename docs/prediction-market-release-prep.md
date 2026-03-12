# Prediction Market Release Prep

This document is the reviewer-facing release summary for the prediction-market
sprint.

As of March 12, 2026, this is a phase-2 release-prep artifact:

- release-facing docs have been cleaned for tracked-path hygiene
- Gate 12 is merged as an explicit fail-closed AVAX production lane
- Gate 13 is merged as contract-validation, proof, and security CI hardening
- reviewer inventory and merge checklist are assembled
- Gate 14 now has a manual staged-live-proof rail, but staged execution is
  still outstanding before the gate can be called complete

This document does not declare the sprint release-ready for unrestricted real
funds. It is the reviewer handoff for the sprint base after Gates 12, 13, and
the docs-release-prep pass.

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
- AVAX production fail-closed semantics through Gate 12
- contract-validation, proof, and security CI promotion through Gate 13

Current dependency state:

- Gate 12: complete as fail-closed AVAX production handling
- Gate 13: complete as contract/security CI promotion
- Gate 14: proof rail implemented; staged live proof execution still
  outstanding

## Reviewer Artifact Inventory

Primary documents:

- [Sprint tracker](enoomian-prediction-market-sprint.md)
- [Production deploy guide](hyperbet-production-deploy.md)
- [Development setup](development-setup.md)
- [Runbook index](runbooks/README.md)
- [Market-maker bot README](../packages/market-maker-bot/README.md)

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
- AVAX is described accurately as fail-closed for production until canonical
  registry addresses are committed
- CI wording reflects the real required lanes:
  - `Solana Program Build Gate`
  - `EVM Contract Validation`
  - `EVM Contract Proof Gate`
  - `EVM Contract Security Gate`
  - `EVM Exploit Gate`
  - `Solana Exploit Gate`
  - `Base Add-Chain Smoke`
- Gate 14 is described as having a proof rail but not yet complete until a real
  staged run succeeds
- targeted checks and broader regression for the dependency gates are green
- sprint tracker is updated after the relevant base-branch push
- ready-to-merge synthesis is written without overstating release readiness

## Residual Risk And Blocked Follow-Ups

- AVAX is still not canonicalized for production; this sprint closes the unsafe
  middle state by failing closed, not by supplying production addresses.
- Contract/security CI is now wired into the repo workflows, but local desktop
  verification can still be constrained by toolchain issues such as Hardhat
  compiler download and macOS-specific Foundry crashes.
- Gate 14 staged live proof remains the largest outstanding operator proof
  before claiming full audit-style deployment confidence.
- Any release-facing summary that omits the AVAX fail-closed state or the
  remaining staged-live-proof work would be misleading.
