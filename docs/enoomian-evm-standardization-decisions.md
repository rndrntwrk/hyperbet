# Enoomian EVM Standardization Decisions

This document records the authoritative keep/adapt/reject decisions for the
local `hyperbet-evm-parity-sweep` assimilation work on top of
`enoomian/prediction-market-sprint-base`.

Status:

- This is a tracked decision log for the assimilation gate.
- It evaluates the current local replay represented by:
  - `57d940d`
  - `f51898d`
  - `1604da6`
  - `c920f0a`
  - `c699c97`
  - `ec8e5f7`
- It is a standardization record, not a direct-merge approval.

## Current Branch Standard

The following remain authoritative today and must not regress:

- `@hyperbet/chain-registry` is the only deployments/runtime source of truth.
- The hardened BSC, AVAX, and Solana keepers define the current backend
  standard.
- The current release-hardening rails remain authoritative:
  - fast CI
  - heavyweight prediction-market gates
  - deploy/proof workflows
  - `scripts/ci-*`
- AVAX remains intentionally fail-closed until canonical production truth
  exists.
- The current operational/runtime surfaces stay canonical:
  - `/status`
  - `/api/arena/prediction-markets/active`
  - `/api/keeper/bot-health`
  - `build-info.json`

## Non-Negotiable Standards

- One deployments/config source of truth only.
- No regression in external-bet security, economics integrity, or duplicate
  protection.
- No regression in lifecycle, claimability, or bot-health surfaces.
- No new canonical surface may exist outside the required CI/deploy coverage.
- Wrapper convergence must never outrun backend/runtime correctness.

## Decision Register Summary

| Subsystem | Decision | Status | Standard To Preserve | Follow-Up |
| --- | --- | --- | --- | --- |
| `packages/hyperbet-deployments` | Keep as materialization layer only | Adapt | `@hyperbet/chain-registry` authority | Phase 1 |
| `packages/hyperbet-evm/app` | Keep as canonical EVM app-shell direction | Keep | current shared UI/runtime correctness | Phase 2 |
| `packages/hyperbet-evm/keeper` | Do not adopt as canonical backend | Reject as-is | current hardened keeper semantics | Phases 3-4 |
| `packages/hyperbet-evm/deployments` | Route through one deployment authority only | Adapt | no duplicate resolver truth | Phase 1 |
| Shared UI/theme/chart/storybook additions | Keep | Keep | current lifecycle/claim correctness | Phase 2 |
| Perps/contracts reconciliation | Keep selectively after newer finality-model reconciliation | Adapt | current contract proof/security bar | Phase 2/contract review |
| Wrapper convergence changes | Keep only after canonical app shell and canonical keeper exist | Defer/Adapt | current wrapper runtime/deploy safety | Phase 6 |

## Detailed Decisions

### 1. `packages/hyperbet-deployments`

- Decision: `Adapt`
- Why:
  - The imported package is useful as a materialized/export layer.
  - It is not acceptable as a second deployments authority.
- Evidence:
  - `packages/hyperbet-chain-registry/src/index.ts` already defines
    `resolveBettingSolanaDeployment` and `resolveBettingEvmDefaults`.
  - `packages/hyperbet-deployments/index.ts` introduces the same concepts again.
- Standard to preserve:
  - `@hyperbet/chain-registry` remains the single authoritative source of
    runtime/deploy truth.
- Follow-up gate:
  - Phase 1: demote `hyperbet-deployments` into a generated/materialized view
    of the registry.

### 2. `packages/hyperbet-evm/app`

- Decision: `Keep`
- Why:
  - The additive EVM app shell is directionally correct.
  - It compiles against the current sprint branch and is compatible with the
    shared theme/runtime direction.
- Evidence:
  - Local validation on the replayed branch passed for:
    - `packages/hyperbet-evm/app`
    - `packages/hyperbet-ui`
    - BSC and AVAX app shells
- Standard to preserve:
  - Current lifecycle, claim-state, and shared UI correctness from the sprint
    branch.
- Follow-up gate:
  - Phase 2: explicitly scope `hyperbet-evm/app` as the canonical EVM app
    shell.

### 3. `packages/hyperbet-evm/keeper`

- Decision: `Reject as-is`
- Why:
  - The imported keeper is behind the sprint branch's current keeper/runtime
    security model.
  - It cannot be treated as canonical until rebuilt on top of the current
    hardened keeper semantics.
- Evidence:
  - `packages/hyperbet-evm/keeper/src/service.ts` still exposes a write-key-only
    `POST /api/arena/bet/record-external` path.
  - The same service still computes points and referral economics from
    client-supplied payload values and uses random bet ids.
  - The service does not currently expose the sprint branch's normalized
    lifecycle/health surfaces:
    - `/api/arena/prediction-markets/active`
    - `/api/keeper/bot-health`
- Standard to preserve:
  - current external-bet verification
  - canonicalized tx-derived economics
  - fallback winner preservation
  - duplicate-safe persistence
  - current lifecycle and bot-health APIs
- Follow-up gate:
  - Phase 3: build a shared hardened EVM keeper core from the current branch
  - Phase 4: rebuild `hyperbet-evm/keeper` on top of that core

### 4. `packages/hyperbet-evm/deployments`

- Decision: `Adapt`
- Why:
  - It is acceptable as a convenience layer only if it stops competing with the
    chain registry.
- Evidence:
  - `packages/hyperbet-evm/deployments/index.ts` currently re-exports and
    redefines deployment-resolution helpers that already exist in
    `@hyperbet/chain-registry`.
- Standard to preserve:
  - no duplicated deployment resolver authority
- Follow-up gate:
  - Phase 1

### 5. Shared UI/theme/chart/storybook additions

- Decision: `Keep`
- Why:
  - These are additive improvements that fit the sprint branch's current shared
    UI direction.
  - They passed local validation without regressing the existing app shells.
- Evidence:
  - local `@hyperbet/ui` tests passed
  - Storybook build passed
  - BSC and AVAX app typechecks passed
- Standard to preserve:
  - current lifecycle- and claim-state correctness
  - no regression in Solana/BSC/AVAX shell behavior
- Follow-up gate:
  - Phase 2

### 6. Perps/contracts reconciliation

- Decision: `Adapt`
- Why:
  - The imported perps/contracts work is directionally useful, but it now sits
    on top of a newer finality/oracle model in the sprint branch and therefore
    cannot be treated as an unreviewed carry-over.
- Evidence:
  - The replay required manual reconciliation in:
    - `packages/evm-contracts/scripts/deploy.ts`
    - `packages/evm-contracts/test/GoldClob.ts`
  - Foundry perps tests passed locally after that reconciliation.
- Standard to preserve:
  - current contract proof/security expectations
  - newer oracle finality model
- Follow-up gate:
  - contract-focused follow-up under Phase 2 planning

### 7. Wrapper convergence changes

- Decision: `Defer/Adapt`
- Why:
  - Thinner wrappers are the right end state.
  - They must not converge onto a weaker backend/runtime model.
- Evidence:
  - The replayed wrapper convergence changes are safe only because they are
    limited to app/runtime shell handling.
  - The imported backend/deployments model is not yet canonical.
- Standard to preserve:
  - current wrapper runtime/deploy semantics
  - AVAX fail-closed posture
- Follow-up gate:
  - Phase 6, after canonical app shell and canonical keeper are complete

## Standardization Phases

### Phase 1: Deployment Materialization Without Competing Authority

Goal:
- keep the useful materialization/export idea
- prevent it from competing with `@hyperbet/chain-registry`

Required changes:
- make `packages/hyperbet-deployments` a generated/materialized layer
- remove duplicate long-term resolver authority from that package
- ensure `hyperbet-evm` consumes the registry directly or through that
  materialized view

Success criteria:
- one authoritative deployments model remains
- no co-equal `resolveBettingSolanaDeployment` /
  `resolveBettingEvmDefaults` implementations remain

### Phase 2: Canonical EVM App Shell

Goal:
- promote `packages/hyperbet-evm/app` as the canonical EVM app shell

Required changes:
- keep the imported app shell
- align docs so it is canonical in the app/runtime-shell layer only
- preserve current shared UI/runtime correctness from the sprint branch
- keep BSC/AVAX wrappers functioning as branded shells

Success criteria:
- `hyperbet-evm/app` is clearly the canonical EVM app shell
- no misleading claims that the backend/keeper is already canonical

### Phase 3: Hardened Shared EVM Keeper Core

Goal:
- make the current sprint keeper semantics the future EVM backend standard

Required changes:
- extract shared EVM keeper modules from the hardened BSC/AVAX keepers
- include:
  - normalized lifecycle/health APIs
  - external-bet verification and economics integrity
  - fallback winner preservation
  - points/referral integrity
  - bot-health/status shaping

Success criteria:
- a hardened shared EVM keeper core exists
- BSC/AVAX keepers remain identical or stricter in behavior

### Phase 4: Canonical `hyperbet-evm/keeper`

Goal:
- rebuild `packages/hyperbet-evm/keeper` on the hardened EVM keeper core

Required changes:
- replace imported legacy behavior with current hardened semantics
- require parity with:
  - `/status`
  - `/api/arena/prediction-markets/active`
  - `/api/keeper/bot-health`
  - strict external-bet handling
  - duplicate-safe persistence
  - current reward/referral integrity

Success criteria:
- `hyperbet-evm/keeper` reaches parity with hardened BSC/AVAX keepers
- only then may it be described as canonical backend/runtime

### Phase 5: CI And Deploy Integration

Goal:
- make the new canonical EVM surfaces first-class in the branch's proof model

Required changes:
- expand CI and heavy gate path filters to include:
  - `packages/hyperbet-evm/**`
  - the retained deployment materialization package, if any
  - any new keeper-core package
- add required checks for canonical EVM app/keeper surfaces
- preserve current deploy topology and AVAX fail-closed semantics

Success criteria:
- no canonical EVM surface can change outside required CI/deploy coverage

### Phase 6: Wrapper Convergence After Canonicalization

Goal:
- make BSC/AVAX wrappers thin only after the canonical app shell and canonical
  keeper are real

Required changes:
- converge wrappers only after Phases 2 and 4 are complete
- keep wrapper-specific:
  - branding
  - env presets
  - deployment entrypoints
  - chain-specific copy/docs

Success criteria:
- wrappers get thinner without runtime or deploy regression
- AVAX remains fail-closed until separately canonicalized

## Required Verification

### Deployment/materialization

- chain-registry tests
- materialization/export package tests
- no duplicate authority checks

### EVM app shell

- `@hyperbet/ui` tests
- Storybook build
- `packages/hyperbet-evm/app` typecheck/build
- BSC/AVAX app typechecks

### EVM keeper core / canonical keeper

- keeper typechecks
- external-bet auth/idempotency/economics tests
- fallback winner tests
- lifecycle/health surface tests

### CI/deploy integration

- workflow/path-filter sanity
- env-audit checks
- no regressions in existing required gates

## Bottom Line

The local assimilation replay is useful as a **design harvest** but not safe as
a wholesale replacement baseline.

The correct standardization path is:

- keep the additive app-shell and shared UI direction
- demote deployment materialization under `@hyperbet/chain-registry`
- rebuild the EVM keeper standard from the sprint branch's current hardened
  truth
- only then converge wrappers and canonical EVM runtime claims
