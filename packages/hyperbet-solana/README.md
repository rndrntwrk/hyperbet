# Hyperbet Solana

Strictly Solana-only Hyperbet package for duel-oracle prediction markets, model perps, and keeper automation.

## What lives here

- `anchor/programs/fight_oracle`: duel lifecycle + authoritative result reporting.
- `anchor/programs/gold_clob_market`: native-SOL CLOB market for duel winner trading and claims.
- `anchor/programs/gold_perps_market`: native-SOL perps market for model trading.
- `anchor/tests/hyperbet.ts`: local validator tests for oracle, CLOB, and cancellation/refund flows.
- `app`: Vite frontend for Solana wallet connect, prediction markets, GOLD flows, and model perps.
- `keeper`: Solana keeper service and bot for stream state ingestion, oracle syncing, market seeding, and resolution.
- `deployments/contracts.json`: shared Solana deployment manifest used by app, keeper, and scripts.

## Runtime model

- The package targets Solana only.
- Duel state is produced by the fight oracle program.
- Prediction markets and perps settle on Solana.
- CLOB collateral and payouts are native SOL.
- GOLD remains the package token for token-specific flows and display where applicable.

## Programs

- Fight oracle: `6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD`
- GOLD CLOB: `ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi`
- GOLD perps: `HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik`
- Mainnet GOLD mint: `DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump`

## Local development

From the package root:

```bash
bun run dev
```

Useful variants:

```bash
bun run dev:local
bun run dev:devnet
bun run dev:testnet
bun run dev:mainnet
bun run dev:stream-ui
```

## Anchor workflow

```bash
bun run anchor:build
bun run anchor:test
```

Or from `anchor/` directly:

```bash
bun install
bun run build
bun run test
```

## Frontend E2E

From `app/`:

```bash
bun run test:e2e:local
bun run test:e2e:testnet
bun run test:e2e:mainnet
```

The local E2E harness is Solana-only. It builds the Anchor programs, starts a local validator, seeds local Solana state, launches the app, and runs Playwright against the Solana flows.

## Keeper

From `keeper/`:

```bash
bun install
```

Run the service:

```bash
bun run service
```

Run the bot once:

```bash
bun run bot -- --once
```

Run the resolver:

```bash
bun run resolve -- --duel-key <hex> --winner a --seed <u64> --replay-hash <hex>
```

Environment examples live in:

- `app/.env.example`
- `keeper/.env.example`

## Deployment

Preflight shared Solana artifacts:

```bash
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
```

Deploy Solana programs:

```bash
bun run anchor:deploy:testnet
bun run anchor:deploy:mainnet
```
