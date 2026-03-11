# Gate 07: Solana External Bot Execution

## Mission

Finish real Solana execution in the external market-maker bot so Solana is no longer health-check only. The external bot must discover markets, place quotes, cancel quotes, resolve inventory, claim settlement, and report health using the same shared strategy engine already used on EVM.

## Status

- Gate: `07`
- Branch: `enoomian/pm-07-solana-bot-execution`
- State: `ready to execute`
- Latest base dependency: `enoomian/prediction-market-sprint-base`
- Upstream gate dependencies: none
- Downstream dependents: Gate 10, Gate 11

## Why This Gate Can Run In Parallel

This gate works in `packages/market-maker-bot` and on local validator-backed Solana execution smoke coverage. It does not need frontend parity work from Gate 06 or simulation backend work from Gate 08 to start.

## Current State

- The external bot already owns the shared strategy loop in `packages/market-maker-bot/src/index.ts`.
- EVM runtime parity is complete for the external bot.
- Solana support in the external bot is still only a readiness/health-check path:
  - `solanaMarketMake(...)` logs that external bot execution is not enabled in this tranche.
- Existing Solana helper utilities already exist:
  - `packages/market-maker-bot/src/solana-helpers.ts`
- Shared strategy decisions already exist in `@hyperbet/mm-core`; this gate must consume them, not recreate them.

## Scope

### In Scope

- Solana market discovery from canonical lifecycle state.
- Solana quote placement.
- Solana quote cancellation.
- Solana claim / cleanup behavior.
- Solana inventory accounting and health reporting inside the external bot.
- Local validator-backed smoke coverage for quote -> cancel -> re-quote -> resolve -> claim.

### Out Of Scope

- Frontend lifecycle parity.
- Simulation backend work.
- Solana exploit families.
- Solana program logic changes unless a defect is proven and moved to a dedicated protocol branch.

## Owned Surfaces

This gate owns these edit surfaces unless coordination is logged:

- `packages/market-maker-bot/src/index.ts`
- `packages/market-maker-bot/src/solana-helpers.ts`
- New Solana adapter files under `packages/market-maker-bot/src/**`
- `packages/market-maker-bot/package.json`
- Bot-specific Solana smoke harness code
- Bot-specific tests under `packages/market-maker-bot/src/*.test.ts`

## Do Not Touch Without Coordination

- `packages/simulation-dashboard/**` belongs to Gate 08.
- `packages/hyperbet-ui/**` and app-shell lifecycle UX belong to Gate 06.
- `packages/hyperbet-solana/anchor/programs/**` requires a protocol branch if it must change.
- Cross-chain end-to-end product flows belong to Gate 10.

## Fixed Inputs And Contracts

The gate must consume these as fixed inputs:

- Shared market-maker strategy engine from `@hyperbet/mm-core`
- Canonical lifecycle feed from `/api/arena/prediction-markets/active`
- Existing Solana PDA helpers in `packages/market-maker-bot/src/solana-helpers.ts`
- Current Solana local scripts and app test harnesses as reference:
  - `packages/hyperbet-solana/app/scripts/run-local-demo.sh`
  - `packages/hyperbet-solana/app/scripts/run-e2e-local.sh`
  - `packages/hyperbet-solana/app/tests/e2e/setup-localnet.ts`

The gate must not redefine:

- `duelKey` identity
- market-kind semantics
- mm-core quote planning logic
- lifecycle status semantics

## Required Deliverables

1. A Solana execution path inside the external bot that can:
   - discover an open duel-winner market
   - derive Solana market/account identifiers
   - place bid/ask quotes
   - cancel tracked quotes
   - observe inventory/position state
   - claim or cleanup after settlement
2. Solana tracked-order and tx-reference bookkeeping that is comparable in quality to the EVM path.
3. Solana health reporting inside the external bot that exposes whether execution is live, degraded, or halted.
4. Local validator-backed smoke coverage for:
   - quote
   - cancel
   - re-quote
   - resolve
   - claim

## Acceptance Criteria

- The external bot can execute real Solana transactions instead of only logging readiness.
- Solana quote state is internally tracked well enough to reconcile stale/cancelled/filled orders.
- Solana claim/cleanup leaves no ghost inventory after settlement in the smoke harness.
- Solana health output is explicit enough for Gate 10 and Gate 11 to consume later.
- No Solana program change is hidden inside this gate branch. Any required program fix is moved to `enoomian/pm-protocol-*`.

## Suggested Work Breakdown

### Workstream A: Solana Adapter

- Define the Solana runtime/adapter surface used by the external bot.
- Keep semantics aligned with the EVM side where possible:
  - discover market
  - place quote
  - cancel quote
  - get position
  - claim
  - health

### Workstream B: Tracking And Recovery

- Add Solana tracked-order bookkeeping.
- Add inventory and quote-age tracking that matches existing bot health patterns.
- Add restart-safe cleanup where possible without overlapping Gate 04 or Gate 10.

### Workstream C: Validator Smoke

- Add a bot-owned local validator smoke harness.
- Prove quote -> cancel -> re-quote -> resolve -> claim on real Solana programs.

## Required Verification Before Merge

- `bun test` in `packages/market-maker-bot`
- `bunx tsc --noEmit -p tsconfig.json` in `packages/market-maker-bot`
- A local validator-backed smoke proving:
  - market discovery
  - order placement
  - order cancellation
  - order replacement
  - settlement claim / cleanup
- If any shared helper or generated client changes are required, document them here and in the sprint tracker before merge

## Cross-Gate Impact To Monitor

- Gate 10 depends on this gate for cross-chain runtime parity and full product-completion flows.
- Gate 11 depends on this gate for final Solana bot smoke commands and operational health expectations.
- Gate 08 may use the same underlying Solana program addresses and PDA math as reference, but should not edit this package.

## Escalation Rules

- If Solana execution requires Anchor client or IDL regeneration, note the generated surfaces explicitly in this document.
- If a Solana program invariant is wrong, stop and create a dedicated protocol branch instead of carrying the fix here.
- If shared helper extraction across bot and simulation becomes necessary, log the coordination note first; default behavior is to keep gate-local helpers local.

## Team Update Contract

Update this document after every branch push with:

- current branch head
- files touched
- execution capabilities completed
- validator smoke status
- any protocol risk discovered
- current blocker, if any

## Update Log

| Date | Branch | Commit | Status | Files Touched | Cross-Gate Impact | Blocker | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-11 | `enoomian/pm-07-solana-bot-execution` | `pending` | ready to execute | none yet | Gate 10 needs live Solana bot parity | none | implement Solana adapter and validator smoke |
