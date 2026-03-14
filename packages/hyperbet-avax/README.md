# Hyperbet AVAX

Avalanche C-Chain focused Hyperbet package for betting, CLOB, and futures interfaces backed by the shared duel oracle.

## What this includes

- `app`: standalone Vite app for wallet connect, market creation, bet placement, EVM GOLD token interactions, settlement, and claiming on Avalanche.
- `keeper`: EVM automation scripts for market-maker seeding and oracle resolution on Avalanche.
- `deployments/contracts.json`: package-local deployment receipts for AVAX contract work. Canonical production truth lives in the shared chain registry.

## EVM Chain Configuration

- **Mainnet**: Avalanche C-Chain (chain ID `43114`)
- **Testnet**: Avalanche Fuji (chain ID `43113`)

Production AVAX rollout is blocked until the shared chain registry contains
canonical AVAX deployment addresses and staged-proof artifacts have been
captured for the target environment. It also depends on the real AVAX
governance/operator wallets being provisioned. Local and testnet flows still
work with explicit env overrides.

`deployments/contracts.json` is updated after manual EVM deployment work, but it must not be treated as canonical production metadata. The app and keeper should use the shared chain registry for production defaults and only use explicit env overrides for local or testnet operation.

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

Those receipts are local package metadata only. They do not make AVAX production-ready on their own; production readiness is controlled by canonical addresses committed to the shared chain registry.

Mainnet deploy preflight now also expects the governance owner set to be
explicit:

- `TIMELOCK_ADDRESS`
- `MULTISIG_ADDRESS` or legacy `ADMIN_ADDRESS`
- `EMERGENCY_COUNCIL_ADDRESS`
- `REPORTER_ADDRESS`
- `FINALIZER_ADDRESS`
- `CHALLENGER_ADDRESS`

Private env files stay local:

- `packages/hyperbet-avax/.env.mainnet`
- `packages/hyperbet-avax/.env.testnet`
- `packages/hyperbet-avax/app/.env.mainnet`

These should hold RPC URLs, signer paths, and private API keys. They should not be treated as public deployment metadata.

## Staged proof canary

From `packages/hyperbet-avax/keeper`:

```bash
bun run proof:canary
```

This is the AVAX canary entrypoint used by the staged live proof wrapper after
the AVAX read-only proof and AVAX staging env audits pass.
