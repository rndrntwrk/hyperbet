# Hyperbet EVM

Canonical EVM Hyperbet package for betting, CLOB, and futures interfaces backed by the shared duel oracle.

This package is the source EVM runtime for themed chain wrappers such as
`packages/hyperbet-avax` and `packages/hyperbet-bsc`. Those wrappers should
own deployment presets, chain branding, and package entrypoints only. Keeper
execution and shared EVM runtime logic belong here.

## What this includes

- `app`: standalone Vite app for wallet connect, market creation, bet placement, EVM GOLD token interactions, settlement, and claiming across supported EVM chains.
- `keeper`: canonical EVM automation scripts for market-maker seeding and oracle resolution.
- `packages/hyperbet-deployments/contracts.json`: shared source of truth for EVM contract addresses, chain IDs, and RPC env var names.

## EVM Chain Configuration

- **Mainnet**: Base, BSC, and Avalanche
- **Testnet**: Base Sepolia, BSC Testnet, and Avalanche Fuji

Contract addresses are populated in `packages/hyperbet-deployments/contracts.json` after EVM deployment. The app reads these at build time; override with env vars at runtime.

## UI E2E tests

From `packages/hyperbet-evm/app`:

```bash
bun run test:e2e
```

What this command does:

- compiles EVM contracts
- starts local Anvil for EVM
- deploys local `MockERC20` + `GoldClob` and seeds an open EVM duel market
- starts the canonical EVM keeper service against local seeded data
- runs the canonical EVM Playwright smoke test against the Vite app

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

The EVM deploy script writes a receipt to `packages/evm-contracts/deployments/<network>.json`
and updates the shared deployment manifests automatically.

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
