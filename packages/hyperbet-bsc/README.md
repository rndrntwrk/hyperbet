# Hyperbet BSC

BSC-themed wrapper over the canonical EVM Hyperbet runtime.

## Role in the architecture

- `packages/hyperbet-evm` is the canonical EVM runtime.
- `packages/hyperbet-bsc` exists to provide BSC deployment defaults, theme, and branded package entrypoints.
- Keeper ownership stays with `hyperbet-evm`; this wrapper delegates keeper scripts back to the canonical EVM package.

## What this package should own

- BSC app theme and chain-facing copy
- BSC deployment defaults exposed by this wrapper
- wrapper-level scripts for app builds and EVM deployments

## What this package should not own long term

- separate Solana or Anchor workflows
- separate keeper implementation
- separate shared UI components
- separate contract logic

## Common commands

From `packages/hyperbet-bsc`:

```bash
bun run dev
bun run build
bun run deploy:evm:bsc-testnet
bun run deploy:evm:bsc
```

Keeper commands delegate to `hyperbet-evm`:

```bash
bun run keeper:service
bun run keeper:bot
```

App E2E commands also delegate to the canonical EVM app:

```bash
bun run --cwd app test:e2e
```
