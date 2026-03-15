# Hyperbet EVM

Additive EVM runtime package and canonical EVM app-shell direction for
Hyperbet.

This package is part of the current EVM standardization effort. On the local
sprint-base standardization path, it should be understood as:

- the canonical EVM app shell
- an additive shared EVM runtime package
- a canonicalized additive EVM keeper/backend surface

The authoritative runtime/deploy model still lives in:

- `@hyperbet/chain-registry` for current chain/runtime truth
- the hardened EVM keeper model now shared with `packages/hyperbet-evm/keeper`
- the current CI/deploy/proof rails for release hardening

For the current keep/adapt/reject decisions, see:

- `docs/enoomian-evm-standardization-decisions.md`

## What this includes

- `app`: shared EVM app shell for wallet connect, market creation, bet
  placement, settlement, and claiming across supported EVM chains
- `keeper`: canonicalized additive EVM keeper/runtime package on the local
  sprint-base standardization path
- `packages/hyperbet-deployments/contracts.json`: additive deployment
  materialization for convergence work; it is not a replacement for the sprint
  branch's authoritative chain/deployment registry

## EVM Chain Configuration

- **Mainnet**: Base, BSC, and Avalanche
- **Testnet**: Base Sepolia, BSC Testnet, and Avalanche Fuji

Current deployment/runtime truth still comes from the sprint branch's existing
registry and deploy model. `packages/hyperbet-deployments/contracts.json` is an
additive manifest for the convergence effort and should be treated as
subordinate to that source of truth until the standardization work is complete.

## UI E2E tests

From `packages/hyperbet-evm/app`:

```bash
bun run test:e2e
```

What this command does:

- compiles EVM contracts
- starts local Anvil for EVM
- deploys local `MockERC20` + `GoldClob` and seeds an open EVM duel market
- starts the additive EVM keeper service against local seeded data
- runs the additive EVM Playwright smoke test against the Vite app

The app runs in `--mode e2e` with generated `/app/.env.e2e`.

## Run the Vite app

From `packages/hyperbet-evm`:

```bash
bun run dev
```

Raw app-only local mode:

```bash
bun run dev:app-local
```

For mainnet mode:

```bash
bun run dev:mainnet
```

For testnet mode:

```bash
bun run dev:testnet
```

Build:

```bash
bun run build
bun run build:testnet
bun run build:mainnet
```

## Keeper

From `packages/hyperbet-evm/keeper`:

```bash
bun install
bun run bot
```

Important:

- this keeper package is canonized locally against the hardened current
  sprint-branch keeper model
- deploy adoption and wrapper retirement still follow the existing sprint
  operational model
- the decision log above is the authoritative status record for that work

## Deployment prep

Preflight the repo before touching real chains:

```bash
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
```

Deploy EVM GoldClob contracts to the desired EVM chain:

```bash
bun run deploy:evm:base-sepolia
bun run deploy:evm:bsc-testnet
bun run deploy:evm:avax-fuji
bun run deploy:evm:base
bun run deploy:evm:bsc
bun run deploy:evm:avax
```

The EVM deploy script writes a receipt to
`packages/evm-contracts/deployments/<network>.json` and may update additive
deployment manifests used for convergence work.

Perps deployment can also bootstrap live markets in one pass via env:

- `PERPS_MARGIN_TOKEN_ADDRESS`: ERC20 collateral token
- `PERPS_FUNDING_VELOCITY`: optional funding velocity override
- `PERPS_OWNER_ADDRESS`: optional final owner for `SkillOracle` and `AgentPerpEngine`
- `PERPS_REPORTER_ADDRESS`: optional oracle publisher allowed to push skill updates
- `PERPS_BOOTSTRAP_MARKETS_JSON`: optional JSON array of markets to seed

Example:

```json
[
  {
    "agentId": "MODEL_A",
    "mu": 1500,
    "sigma": 50,
    "insuranceFund": "10000",
    "status": "ACTIVE"
  }
]
```

Private env files stay local:

- `packages/hyperbet-evm/.env.mainnet`
- `packages/hyperbet-evm/.env.testnet`
- `packages/hyperbet-evm/app/.env.mainnet`

These should hold RPC URLs, signer paths, and private API keys. They should not be treated as public deployment metadata.
