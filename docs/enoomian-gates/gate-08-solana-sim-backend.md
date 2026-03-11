# Gate 08: Solana Validator-Backed Simulation Backend

## Mission

Build a validator-backed Solana scenario backend inside `packages/simulation-dashboard` so Solana exploit testing uses the real `fight_oracle` and `gold_clob_market` programs, not an in-memory approximation. The backend must emit the same `ScenarioResult` contract already used by the EVM simulation path.

## Status

- Gate: `08`
- Branch: `enoomian/pm-08-solana-sim-backend`
- State: `ready to execute`
- Latest base dependency: `enoomian/prediction-market-sprint-base`
- Upstream gate dependencies: none
- Downstream dependents: Gate 09, Gate 11

## Why This Gate Can Run In Parallel

This gate works inside `packages/simulation-dashboard` and its own Solana runner support. It does not depend on frontend parity from Gate 06 or external Solana bot execution from Gate 07.

## Current State

- The simulation system is currently EVM/Anvil-first:
  - `packages/simulation-dashboard/src/server.ts`
  - `packages/simulation-dashboard/src/agents.ts`
  - `packages/simulation-dashboard/src/helpers.ts`
- The HTTP/API surface and `ScenarioResult` model already exist.
- Solana program sources already exist and are real:
  - `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
  - `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- There is no validator-backed Solana execution backend yet.

## Scope

### In Scope

- Internal backend abstraction for simulation execution.
- Local validator lifecycle management for Solana simulation runs.
- Real-program Solana market setup, execution, resolution, and result capture.
- Reuse of the existing `ScenarioResult` shape.
- At least one normal Solana scenario and one adversarial Solana scenario as backend proof.

### Out Of Scope

- Solana exploit family expansion beyond backend proof. That belongs to Gate 09.
- External bot Solana execution. That belongs to Gate 07.
- Frontend work.
- Solana program changes unless a defect is proven and moved to a protocol branch.

## Owned Surfaces

This gate owns these edit surfaces unless coordination is logged:

- `packages/simulation-dashboard/src/server.ts`
- `packages/simulation-dashboard/src/agents.ts`
- `packages/simulation-dashboard/src/helpers.ts`
- `packages/simulation-dashboard/src/scenario-catalog.ts`
- `packages/simulation-dashboard/src/scenario-evaluator.ts`
- New simulation-owned Solana backend files under `packages/simulation-dashboard/src/**`
- `packages/simulation-dashboard/package.json`
- Simulation-owned scripts under `packages/simulation-dashboard/**`

## Do Not Touch Without Coordination

- `packages/market-maker-bot/**` belongs to Gate 07.
- `packages/hyperbet-ui/**` and app shells belong to Gate 06.
- `packages/hyperbet-solana/anchor/programs/**` requires a protocol branch if it must change.
- Solana exploit-family expansion belongs to Gate 09 once the backend is stable.

## Fixed Inputs And Contracts

The gate must preserve these interfaces:

- Simulation HTTP/API surface:
  - `GET /api/scenarios`
  - `GET /api/scenarios/results`
  - `GET /api/state`
  - `GET /api/scenarios/run?...`
- Shared `ScenarioResult` contract used by the EVM backend
- Existing scenario history persistence behavior

The gate may add internal backend selection, but it must not force downstream consumers to adopt a second result shape.

## Required Deliverables

1. An internal Solana backend that can:
   - boot a local validator
   - connect to real Solana programs
   - set up a duel-winner market
   - execute scenario actions using real transactions
   - resolve and collect settlement outcome
   - emit a valid `ScenarioResult`
2. One normal Solana scenario proving the backend can complete a non-adversarial flow.
3. One adversarial Solana scenario proving the backend can survive a real red-team style action path and still emit a `ScenarioResult`.
4. Clear backend-selection semantics that do not break existing EVM scenario consumers.

## Acceptance Criteria

- The simulation backend can run against a local validator and real Solana programs.
- The API surface remains stable from the perspective of scenario consumers.
- The result shape remains `ScenarioResult`, not a Solana-specific fork.
- Scenario history persists Solana runs alongside EVM runs in a readable way.
- Gate 09 can build exploit families on top of this backend without rewriting the backend contract.

## Suggested Work Breakdown

### Workstream A: Backend Abstraction

- Make backend selection internal to simulation execution.
- Keep HTTP and CLI semantics stable.

### Workstream B: Validator And Program Runtime

- Boot or connect to a local validator.
- Load real Solana program addresses and accounts.
- Build the minimal duel and market lifecycle needed to run scenarios.

### Workstream C: Scenario Proofs

- Add one normal scenario.
- Add one adversarial scenario.
- Emit comparable metrics and traces in `ScenarioResult`.

## Required Verification Before Merge

- `bunx tsc --noEmit -p tsconfig.json` in `packages/simulation-dashboard`
- One runner boot smoke on Solana backend
- One normal Solana scenario run producing a valid `ScenarioResult`
- One adversarial Solana scenario run producing a valid `ScenarioResult`
- Existing EVM scenario behavior remains intact after backend abstraction work

## Cross-Gate Impact To Monitor

- Gate 09 is blocked on this gate and will consume its backend contract immediately.
- Gate 11 will need stable commands and environment expectations from this gate for CI and ops documentation.
- If this gate discovers the existing `ScenarioResult` contract is insufficient, document the gap here before changing shared types.

## Escalation Rules

- If the backend requires changes to Solana programs or generated clients, stop and move that work into a dedicated protocol branch.
- Do not pull `packages/market-maker-bot` into this gate to share execution logic unless that coordination is explicitly approved and logged.
- Keep backend-specific helpers inside `packages/simulation-dashboard` to preserve ownership boundaries.

## Team Update Contract

Update this document after every branch push with:

- current branch head
- files touched
- backend capabilities completed
- Solana scenario proofs completed
- any API/result-shape change proposed
- current blocker, if any

## Update Log

| Date | Branch | Commit | Status | Files Touched | Cross-Gate Impact | Blocker | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-11 | `enoomian/pm-08-solana-sim-backend` | `pending` | ready to execute | none yet | Gate 09 is blocked until this backend exists | none | implement backend abstraction and validator proof runs |
