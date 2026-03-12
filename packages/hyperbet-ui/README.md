# @hyperbet/ui

Shared Hyperbet UI package for Solana and EVM runtimes.

## Purpose

`@hyperbet/ui` owns:

- shared UI components
- shared theme system
- shared app-root factories
- shared spectator and streaming primitives
- shared chain/runtime helpers used by Hyperbet apps

Chain-specific apps should consume this package rather than re-implementing shared UI behavior.

## Main entrypoints

- root barrel: `@hyperbet/ui`
- app roots:
  - `@hyperbet/ui/createAppRoot`
  - `@hyperbet/ui/createEvmAppRoot`
- theme:
  - `@hyperbet/ui/lib/theme`
- chain context:
  - `@hyperbet/ui/lib/ChainContext`
- shared components:
  - `@hyperbet/ui/components/*`

## Theme model

Supported theme ids:

- `evm`
- `avax`
- `bsc`
- `base`
- `solana`

Components may inherit theme from `HyperbetThemeProvider` or accept an explicit `theme` override when exposed.

## Storybook

Run locally from this package:

```bash
bun run storybook
```

Build static docs:

```bash
bun run storybook:build
```
