# Hyperbet AVAX

Avalanche C-Chain focused Hyperbet package for betting, CLOB, and futures interfaces backed by the shared duel oracle.

## What this includes

- `app`: standalone Vite app for wallet connect, market creation, bet placement, EVM GOLD token interactions, settlement, and claiming on Avalanche.
- `keeper`: EVM automation scripts for market-maker seeding and oracle resolution on Avalanche.
- `deployments/contracts.json`: shared source of truth for AVAX contract addresses, chain IDs, and RPC env var names.

## EVM Chain Configuration

- **Mainnet**: Avalanche C-Chain (chain ID `43114`)
- **Testnet**: Avalanche Fuji (chain ID `43113`)

Contract addresses are populated in `deployments/contracts.json` after EVM deployment. The app reads these at build time; override with env vars at runtime.

## UI E2E tests (headless wallet + mock GOLD localnet)

From `packages/hyperbet-avax/app`:

```bash
bun run test:e2e
```

What this command does:

- compiles EVM contracts
- starts local Anvil for EVM (chain id 43113)
- deploys local `MockERC20` + `GoldClob`, seeds an open EVM match, and configures headless EVM wallet
- creates one resolved historical market and one open current market
- runs Playwright headless tests that exercise EVM UI actions and verify txs on-chain:
  - EVM: refresh, place order, resolve match, claim, create match
  - chain-level validation:
    - EVM tx hashes are confirmed with successful receipts on local Anvil RPC

The app runs in `--mode e2e` with generated `/app/.env.e2e`.

## UI E2E tests on public clusters (headless wallet)

From `packages/hyperbet-avax/app`:

```bash
bun run test:e2e:testnet
bun run test:e2e:mainnet
```

## Run the Vite app

From `packages/hyperbet-avax`:

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

From `packages/hyperbet-avax/keeper`:

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

Deploy EVM GoldClob contracts to Avalanche:

```bash
bun run deploy:evm:avax-fuji
bun run deploy:evm:avax
```

The EVM deploy script writes a receipt to `packages/evm-contracts/deployments/<network>.json`
and updates `packages/hyperbet-avax/deployments/contracts.json` automatically.

Private env files stay local:

- `packages/hyperbet-avax/.env.mainnet`
- `packages/hyperbet-avax/.env.testnet`
- `packages/hyperbet-avax/app/.env.mainnet`

These should hold RPC URLs, signer paths, and private API keys. They should not be treated as public deployment metadata.
