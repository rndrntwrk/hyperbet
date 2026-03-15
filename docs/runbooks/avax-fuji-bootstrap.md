# AVAX Fuji Bootstrap Market Smoke

This runbook is for maintaining a fresh, tradable AVAX Fuji market for local and
testnet validation.

## Scope

- local validation of keeper/app/contract wiring on Fuji
- manual smoke path for an open betting market
- repeatable startup and cleanup sequence before operator UI checks

## Prerequisites

- funded Fuji wallets for:
  - reporter (oracle writer)
  - market operator (market creation/keeper controls)
  - canary trader (UI/market making smoke)
  - market operator key must have `MARKET_OPERATOR_ROLE` on the Fuji GoldClob contract
- AVAX Fuji RPC URL
- local keeper running at `http://127.0.0.1:5555`
- scripts/dependencies available from repo root

## Environment Variables

Set these for the bootstrap run:

- `AVAX_FUJI_RPC` (or `AVAX_RPC_URL`) — Fuji JSON-RPC URL
- `AVAX_DUEL_ORACLE_ADDRESS`
- `AVAX_GOLD_CLOB_ADDRESS`
- `KEEPER_URL` — usually `http://127.0.0.1:5555`
- `REPORTER_PRIVATE_KEY`
- `MARKET_OPERATOR_PRIVATE_KEY`
- `CANARY_PRIVATE_KEY`

Keep these secrets in a local gitignored env file (for example
`packages/hyperbet-avax/keeper/.env.local`) and source them when invoking commands.

## Bootstrap Sequence

1. Start the AVAX keeper and any required chain/testnet tooling.
2. From repo root run:

```bash
cd /Users/mac/Desktop/hyperbet
AVAX_FUJI_RPC=... \
AVAX_DUEL_ORACLE_ADDRESS=0x... \
AVAX_GOLD_CLOB_ADDRESS=0x... \
KEEPER_URL=http://127.0.0.1:5555 \
REPORTER_PRIVATE_KEY=0x... \
MARKET_OPERATOR_PRIVATE_KEY=0x... \
CANARY_PRIVATE_KEY=0x... \
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs
```

If you keep these in a shell env file, source it first:

```bash
set -a
source /path/to/.env.avax-fuji-bootstrap
set +a
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs
```

3. Confirm output includes:
   - `market is OPEN in keeper`
   - place-order tx hash
   - optional claim/cleanup log
4. Confirm the script does not fail earlier with:
   - role-check error (no configured operator key has MARKET_OPERATOR_ROLE)
   - anything-to-claim reverts when pre-claim position is zero
5. Verify via keeper API that the market is no longer terminal after initial setup:

```bash
curl -s http://127.0.0.1:5555/api/arena/prediction-markets/active | jq
```

6. If the output shows `nothing to claim expected...`, run a fresh duel/retry rather than forcing claim cleanup.

## Acceptance Criteria

- script reaches completion without unhandled revert
- new market appears in keeper active markets with `OPEN`
- placeOrder succeeds on-chain and keeper sees the update
- cancel + sync path succeeds
- claim cleanup path is either:
  - claimed with cleared market position, or
  - intentionally skipped because there is no claimable residual

## Failure Drill

- If `openTs/closeTs` windows are rejected, re-run with a fresh `duelKey`.
- If `claim` reverts with a valid `nothing to claim` path, treat it as expected only
  when pre-claim position was zero.
- If market never becomes `OPEN`, verify keeper publish endpoint is reachable and
  stream state shape is valid.
