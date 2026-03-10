# Hyperbet AVAX

Avalanche C-Chain focused Hyperbet package for betting, CLOB, and futures interfaces backed by the shared duel oracle.

## What this includes

- `app`: standalone Vite app for wallet connect, market creation, bet placement, EVM GOLD token interactions, settlement, and claiming on Avalanche.
- `deployments/contracts.json`: shared source of truth for AVAX contract addresses, chain IDs, and RPC env var names.

## EVM Chain Configuration

- **Mainnet**: Avalanche C-Chain (chain ID `43114`)
- **Testnet**: Avalanche Fuji (chain ID `43113`)

Contract addresses are populated in `deployments/contracts.json` after EVM deployment. The app reads these at build time; override with env vars at runtime.

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

## Local E2E tests (Anchor + mock GOLD)

From `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/anchor`:

```bash
bun install
bun run build
bun run test
```

`bun run test` now uses a manual `solana-test-validator` harness instead of `anchor test`, because the Anchor CLI wrapper was operationally unstable on this machine. The harness still runs the real programs against a real local validator.

Passing tests currently:

- market-maker auto seed after 10 seconds when market is empty
- oracle resolve + winner claim payout flow

Rust verification commands:

```bash
bun run lint:rust
bun run test:rust
bun run audit
bun run audit:strict
```

`bun run audit` ignores `RUSTSEC-2025-0141` for `bincode` because RustSec marks all `bincode` releases as unmaintained and provides no patched version. The current Anchor/Solana Rust stack still depends on it, so this is an explicit upstream risk acceptance.
`bun run audit:strict` fails on any audit warning, including that `bincode` advisory.

## UI E2E tests (headless wallet + mock GOLD localnet)

From `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/app`:

```bash
bun run test:e2e
```

What this command does:

- builds Anchor programs
- compiles EVM contracts
- starts a local validator with both demo programs preloaded
- starts local Anvil (chain id 97) for EVM
- seeds a deterministic mock GOLD mint + test wallet
- deploys local `MockERC20` + `GoldClob`, seeds an open EVM match, and configures headless EVM wallet
- creates one resolved historical market and one open current market
- runs Playwright headless tests that exercise Solana + EVM UI actions and verify txs on-chain:
  - Solana: refresh, seed-liquidity, place bet, resolve, claim, start new round
  - EVM: refresh, place order, resolve match, claim, create match
  - chain-level validation:
    - Solana tx signatures are confirmed with success on local validator RPC
    - EVM tx hashes are confirmed with successful receipts on local Anvil RPC

The app runs in `--mode e2e` with generated `/app/.env.e2e`.

## UI E2E tests on public clusters (headless wallet)

From `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/app`:

```bash
bun run test:e2e:testnet
bun run test:e2e:mainnet
```

What public E2E does:

- loads keypair from `E2E_HEADLESS_KEYPAIR_PATH` (defaults to `~/.config/solana/id.json`) or `E2E_HEADLESS_WALLET_SECRET_KEY`
- verifies oracle + market programs are deployed and executable on selected cluster
- initializes oracle config (if needed), then creates:
  - one short resolved market (for "last result")
  - one open current market (for bet flow)
- writes `/app/.env.e2e` for Vite headless wallet auto-connect
- runs Playwright against the live app in headless mode

Useful public E2E env vars:

- `E2E_CLUSTER`: `testnet` or `mainnet-beta` (script sets this for you)
- `E2E_HEADLESS_KEYPAIR_PATH`: wallet keypair path for headless test signing
- `E2E_RPC_URL`: override RPC endpoint
- `E2E_TESTNET_GOLD_MINT`: optional existing testnet GOLD-like mint; when omitted a mock Token-2022 mint is created automatically
- `E2E_DEPLOY_TESTNET_PROGRAMS=true`: optional one-time deploy attempt before testnet E2E run

Notes for balances:

- Mainnet E2E uses real GOLD mint `DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump`.
- If the wallet has no GOLD, test automatically places bet using `SOL` (swap-to-GOLD path), while seed-liquidity is expected to fail unless wallet already has GOLD.
- For full mainnet button-success flow (including seed), pre-fund the headless wallet with GOLD.
- Testnet deploy-on-demand now deploys all three Solana betting programs (`fight_oracle`, `gold_clob_market`, `gold_perps_market`) using the checked-in program keypairs.
- Testnet deploy-on-demand needs enough SOL for all program deploys. Plan for approximately `>= 4 SOL` before deploy.

## Run the Vite app

From `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc`:

```bash
bun run dev
```

`bun run dev` now boots a full local demo stack:

- builds Anchor programs
- starts `solana-test-validator` with oracle + market programs preloaded
- seeds local mock GOLD + active market state
- starts Vite on `http://127.0.0.1:4179`

Raw app-only local mode (without validator bootstrap):

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

## Keeper scripts

From `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/keeper`:

```bash
bun install
```

Seed liquidity (after 10s if empty):

```bash
HELIUS_API_KEY=... \
MARKET_MAKER_KEYPAIR=~/.config/solana/id.json \
bun run seed -- --match-id 123456 --seed-gold 1
```

Resolve from oracle with authoritative result data:

```bash
HELIUS_API_KEY=... \
ORACLE_AUTHORITY_KEYPAIR=~/.config/solana/id.json \
bun run resolve -- --match-id 123456 --winner yes --seed 123456789 --replay-hash <64-hex-chars>
```

Run autonomous market bot (creates markets, resolves, seeds):

```bash
HELIUS_API_KEY=... \
ORACLE_AUTHORITY_KEYPAIR=~/.config/solana/id.json \
MARKET_MAKER_KEYPAIR=~/.config/solana/id.json \
GOLD_MINT=DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump \
BET_FEE_BPS=100 \
BOT_LOOP=true \
bun run keeper:bot
```

Using cluster-aware defaults from env files:

```bash
bun run keeper:bot:mainnet
bun run keeper:bot:testnet
bun run keeper:bot:once
```

Bot behavior:

- ensures oracle + market config are initialized
- creates a new market whenever no bettable market exists
- resolves open markets only after authoritative duel result data is available
- auto-seeds empty markets after delay using market-maker wallet balance (including collected fees)

## Deployment prep

Preflight the repo before touching real chains:

```bash
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
```

Deploy Solana programs with the checked-in keypairs:

```bash
bun run anchor:deploy:testnet
bun run anchor:deploy:mainnet
```

Deploy EVM GoldClob contracts:

```bash
bun run deploy:evm:bsc-testnet
bun run deploy:evm:bsc
# optional if you want Base enabled too
bun run deploy:evm:base-sepolia
bun run deploy:evm:base
```

The EVM deploy script now writes a receipt to `/Users/shawwalters/eliza-workspace/hyperbet/packages/evm-contracts/deployments/<network>.json`
and updates `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/deployments/contracts.json` automatically.

Private env files stay local:

- `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/.env.mainnet`
- `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/.env.testnet`
- `/Users/shawwalters/eliza-workspace/hyperbet/packages/hyperbet-bsc/app/.env.mainnet`

These should hold RPC URLs, signer paths, and private API keys. They should not be treated as public deployment metadata.

## Notes

- App now auto-discovers and displays `current market` + `last resolved result` and continuously refreshes state.
- App place-bet path auto-creates a market when none exists (requires oracle authority wallet); recommended production mode is running `keeper:bot`.
- Market setup inputs are removed from the UI for the demo path (fixed mint, no manual PDA loading).
- App localnet mode does not execute SOL/USDC conversion in UI; use direct GOLD in local mode. Jupiter conversion path is wired for mainnet.
- Anchor build uses a vendored `zmij` patch in `anchor/vendor/zmij` to avoid a toolchain incompatibility during IDL build on this machine.
