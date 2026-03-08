# Hyperbet

Private monorepo for Hyperbet betting, gambling, and futures products.

## Packages

- `packages/hyperbet-solana`: Solana-focused betting stack copied from the current betting workspace.
- `packages/hyperbet-bsc`: BSC-focused betting stack copied from the current betting workspace.
- `packages/evm-contracts`: Hyperbet-owned EVM contracts for CLOB and futures flows.

## Relationship To Hyperscape

The game stays in the `hyperscape` monorepo.

Hyperbet consumes duel arena oracle artifacts published from Hyperscape:

- Solana oracle IDL/types
- EVM duel outcome oracle ABI/artifacts

## Commands

```bash
bun install
bun run build
bun run dev:solana
bun run dev:bsc
```
