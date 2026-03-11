# Gate 06: Frontend Settlement And Claim Parity

## Mission

Make Solana, BSC, and AVAX app shells treat the normalized prediction-market lifecycle surface as the canonical source of truth for active, locked, resolved, cancelled, and claimable state. On-chain reads remain confirmation or fallback, not primary lifecycle discovery.

## Status

- Gate: `06`
- Branch: `enoomian/pm-06-frontend-settlement`
- State: `ready to execute`
- Latest base dependency: `enoomian/prediction-market-sprint-base`
- Upstream gate dependencies: none
- Downstream dependents: Gate 10, Gate 11

## Why This Gate Can Run In Parallel

This gate works on shared UI and app-shell parity. It consumes normalized lifecycle data that already exists and does not require live Solana execution in the external bot or a validator-backed Solana simulation backend to make progress.

## Current State

- The canonical lifecycle client exists in `packages/hyperbet-ui/src/lib/predictionMarkets.ts`.
- Shared panels already consume lifecycle data in part:
  - `packages/hyperbet-ui/src/components/EvmBettingPanel.tsx`
  - `packages/hyperbet-ui/src/components/SolanaClobPanel.tsx`
- Solana, BSC, and AVAX app shells still drift from one another:
  - `packages/hyperbet-solana/app/src/App.tsx`
  - `packages/hyperbet-bsc/app/src/App.tsx`
  - `packages/hyperbet-avax/app/src/App.tsx`
- BSC in particular still exposes an older bespoke shell path instead of cleanly presenting the shared lifecycle-driven market surface.
- Gate 05 verified runtime parity without depending on the app shell because the frontend is still the drifted layer.

## Scope

### In Scope

- Shared lifecycle-to-UI mapping.
- Shared claimability rules in the frontend.
- Shared resolved/cancelled/locked state rendering.
- Reducing Solana/BSC/AVAX shell divergence where it affects prediction-market lifecycle and claim UX.
- Narrow API-driven lifecycle smoke coverage for the three apps.

### Out Of Scope

- External bot runtime behavior.
- Simulation backend work.
- Keeper runtime assembly.
- Protocol/program/contract changes.
- Full end-to-end create -> seed -> trade -> lock -> resolve -> claim reliability coverage. That belongs to Gate 10.

## Owned Surfaces

This gate owns these edit surfaces unless coordination is logged:

- `packages/hyperbet-ui/src/lib/predictionMarkets.ts`
- `packages/hyperbet-ui/src/lib/predictionMarketTracking.ts`
- `packages/hyperbet-ui/src/components/EvmBettingPanel.tsx`
- `packages/hyperbet-ui/src/components/SolanaClobPanel.tsx`
- `packages/hyperbet-ui/src/components/PredictionMarketPanel.tsx`
- `packages/hyperbet-ui/src/createAppRoot.tsx`
- `packages/hyperbet-ui/src/createEvmAppRoot.tsx`
- `packages/hyperbet-solana/app/src/App.tsx`
- `packages/hyperbet-solana/app/src/AppRoot.tsx`
- `packages/hyperbet-bsc/app/src/App.tsx`
- `packages/hyperbet-bsc/app/src/AppRoot.tsx`
- `packages/hyperbet-avax/app/src/App.tsx`
- `packages/hyperbet-avax/app/src/AppRoot.tsx`
- Narrow lifecycle smoke tests under the three app packages, but not Gate 10 product-completion flows

## Do Not Touch Without Coordination

- `packages/market-maker-bot/**` belongs to Gate 07.
- `packages/simulation-dashboard/**` belongs to Gate 08.
- `packages/hyperbet-solana/anchor/programs/**` requires a protocol branch if it must change.
- Cross-chain product-completion E2E flows belong to Gate 10.

## Fixed Inputs And Contracts

The gate must consume these as stable inputs:

- Canonical lifecycle endpoint:
  - `GET /api/arena/prediction-markets/active`
- Current normalized client:
  - `packages/hyperbet-ui/src/lib/predictionMarkets.ts`
- Current shared market panels:
  - `packages/hyperbet-ui/src/components/EvmBettingPanel.tsx`
  - `packages/hyperbet-ui/src/components/SolanaClobPanel.tsx`
- Current sprint tracker:
  - `docs/enoomian-prediction-market-sprint.md`

The gate must not redefine:

- Lifecycle statuses
- Winner encoding
- `duelKey` normalization rules
- Chain registry semantics

## Required Deliverables

1. One shared lifecycle-to-UI state model for:
   - active/open
   - locked
   - resolved winner A
   - resolved winner B
   - cancelled
   - claimable / not claimable
2. BSC, AVAX, and Solana shells render prediction-market lifecycle off the normalized lifecycle surface first, with chain reads used only for confirmation/fallback.
3. BSC app shell no longer blocks the shared claim/settlement path behind the older bespoke surface.
4. Shared claim state is presented consistently across EVM and Solana panels.
5. Narrow API-driven lifecycle smoke coverage exists for all three app packages.

## Acceptance Criteria

- The resolved winner shown in the UI matches normalized lifecycle state for Solana, BSC, and AVAX.
- Claim CTA availability is derived from normalized lifecycle plus explicit chain confirmation where needed, not from app-shell-specific heuristics.
- App shells no longer disagree on whether a market is open, locked, resolved, or claimable.
- BSC and AVAX no longer require bespoke lifecycle discovery paths.
- The shared UI can explain failure states without falling back to stale panel-specific assumptions.

## Suggested Work Breakdown

### Workstream A: Shared Lifecycle State Model

- Audit every place lifecycle status is translated into UI copy or button state.
- Centralize lifecycle-to-claimability rules in shared UI code.
- Make panel rendering derive from one model, not parallel ad hoc checks.

### Workstream B: Shell Convergence

- Strip BSC and AVAX app-shell logic down to wrapper concerns only.
- Remove shell-level logic that competes with shared lifecycle state.
- Align Solana shell behavior where it has diverged from shared panel expectations.

### Workstream C: Verification

- Add or update narrow lifecycle smoke specs for Solana, BSC, and AVAX app packages.
- Verify the shared lifecycle client is the source of truth used in those smokes.

## Required Verification Before Merge

- `bun test` or equivalent targeted shared UI tests covering lifecycle parsing and claim-state logic
- `bunx tsc --noEmit -p tsconfig.json` in:
  - `packages/hyperbet-ui`
  - `packages/hyperbet-solana/app`
  - `packages/hyperbet-bsc/app`
  - `packages/hyperbet-avax/app`
- One API-driven lifecycle smoke per app package proving:
  - open renders correctly
  - locked renders correctly
  - resolved winner renders correctly
  - claimability is surfaced correctly

## Cross-Gate Impact To Monitor

- Gate 10 depends on this gate to stop app-shell drift from masking backend/runtime correctness.
- Gate 11 will need final commands and stable test entrypoints from this gate for CI wiring.
- If this gate discovers lifecycle fields are insufficient, log the gap in this document and the sprint tracker before changing upstream contracts.

## Team Update Contract

Update this document after every branch push with:

- current branch head
- files touched
- verification completed
- UI states made canonical
- any changes that Gate 10 or Gate 11 must know about
- current blocker, if any

## Update Log

| Date | Branch | Commit | Status | Files Touched | Cross-Gate Impact | Blocker | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-11 | `enoomian/pm-06-frontend-settlement` | `pending` | ready to execute | none yet | Gate 10 waiting on shell parity | none | converge lifecycle-driven shell behavior |
