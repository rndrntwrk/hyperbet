# Hyperbet AVAX

Avalanche-themed wrapper over the canonical EVM Hyperbet runtime.

## Role in the architecture

- `packages/hyperbet-evm` is the canonical EVM runtime.
- `packages/hyperbet-avax` exists to provide Avalanche-specific deployment defaults, theme, and branded package entrypoints.
- Keeper ownership stays with `hyperbet-evm`; this wrapper delegates keeper scripts back to the canonical EVM package.

## What this package should own

- Avalanche app theme and chain-facing copy
- Avalanche deployment defaults and manifests
- Avalanche package-level scripts for app builds and chain deployments

## What this package should not own long term

- separate keeper implementation
- separate market logic
- separate shared UI components
- separate contract logic

## Common commands

From `packages/hyperbet-avax`:

```bash
bun run dev
bun run build
bun run deploy:evm:avax-fuji
bun run deploy:evm:avax
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
