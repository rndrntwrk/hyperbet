# Enoomian Parallel Gate Workstreams

This folder is the handoff surface for the remaining sprint gates that can be worked in parallel without creating intentional file ownership overlap.

Use this folder with the sprint tracker in `docs/enoomian-prediction-market-sprint.md`.

## Operating Rules

1. Every team owns one gate document and updates it after every branch push, not only after merges to the sprint base.
2. Every team must read all gate documents in this folder before starting work for the day and before rebasing or merging.
3. If a task requires editing a file reserved to another gate, stop and add a coordination note in both gate docs before changing code.
4. If a task proves a protocol defect in Solana or EVM contracts/programs, stop and move the fix to a dedicated `enoomian/pm-protocol-*` branch. Do not hide protocol work inside a gate branch.
5. The sprint base remains the integration trunk: `enoomian/prediction-market-sprint-base`.

## Gates That Can Run In Parallel Now

| Gate | Doc | Why It Can Run Now | Primary Owned Surfaces | Immediate Consumers |
| --- | --- | --- | --- | --- |
| 06 | `gate-06-frontend-settlement.md` | Depends on existing normalized lifecycle data and shared UI, not on Solana bot execution or Solana simulation | `packages/hyperbet-ui`, app shells under `packages/hyperbet-{solana,bsc,avax}/app` | Gate 10, Gate 11 |
| 07 | `gate-07-solana-bot-execution.md` | Depends on existing `@hyperbet/mm-core`, normalized lifecycle reads, and live Solana programs, but not on frontend parity or simulation backend work | `packages/market-maker-bot`, local validator smoke helpers owned by the bot | Gate 10, Gate 11 |
| 08 | `gate-08-solana-sim-backend.md` | Depends on existing EVM simulation architecture and real Solana programs, but not on frontend parity or external Solana bot execution | `packages/simulation-dashboard` and Solana-runner support code owned by simulation | Gate 09, Gate 11 |

## Gates Explicitly Blocked From Parallel Execution

| Gate | Status | Why It Is Blocked |
| --- | --- | --- |
| 09 | Blocked | Requires the validator-backed Solana scenario backend from Gate 08 before Solana exploit families can be implemented against a stable backend. |
| 10 | Blocked | This is the integration gate by definition. It depends on Gate 06 frontend parity, Gate 07 Solana bot execution, and the Solana scenario/runtime stabilization that follows Gate 08 and Gate 09. |
| 11 | Blocked | CI, add-chain proof, env safety, and runbooks should wire finished gate surfaces into automation after the runtime, frontend, and simulation contracts stabilize. |
| Protocol gates | Blocked unless triggered | These only activate when another gate proves an off-chain mitigation is insufficient or a program/contract invariant is wrong. |

## Ownership Boundaries

| Surface | Gate Owner | Notes |
| --- | --- | --- |
| `packages/hyperbet-ui` lifecycle and claim UX | Gate 06 | Gate 07 and Gate 08 may consume behavior as clients but should not modify UI logic. |
| `packages/market-maker-bot` Solana execution | Gate 07 | Gate 08 should not edit this package. Shared helper extraction is out of scope unless explicitly coordinated. |
| `packages/simulation-dashboard` Solana backend | Gate 08 | Gate 07 should not add simulation code here. |
| Solana program source in `packages/hyperbet-solana/anchor/programs` | No gate owner by default | Changes here require a dedicated protocol branch unless there is explicit sprint-lead approval to fold them into a gate. |
| Cross-chain E2E specs as product-completion coverage | Gate 10 | Gate 06 may add narrow API-driven lifecycle smokes only. Full create -> seed -> trade -> lock -> resolve -> claim belongs to Gate 10. |

## Required Updates In Every Gate Doc

Each team must keep these fields current in its gate doc:

- `Status`
- `Active branch`
- `Latest commit pushed`
- `Files touched in this gate`
- `What changed since last update`
- `Cross-gate impact`
- `Current blocker`
- `Next verification step`

## Parallel Gate Documents

- [Gate 06: Frontend Settlement](/Users/mac/Desktop/hyperbet/docs/enoomian-gates/gate-06-frontend-settlement.md)
- [Gate 07: Solana External Bot Execution](/Users/mac/Desktop/hyperbet/docs/enoomian-gates/gate-07-solana-bot-execution.md)
- [Gate 08: Solana Validator-Backed Simulation Backend](/Users/mac/Desktop/hyperbet/docs/enoomian-gates/gate-08-solana-sim-backend.md)
