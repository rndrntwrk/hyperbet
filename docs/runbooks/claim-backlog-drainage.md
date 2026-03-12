# Claim Backlog Drainage

## Symptoms

- resolved or cancelled markets accumulate claimable state without clearing
- users report `Nothing claimable yet` after valid settlement
- backlog grows after a restart or outage recovery

## Detection

```bash
curl -fsSL "$KEEPER_URL/api/arena/prediction-markets/active" | jq
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
curl -fsSL "$KEEPER_URL/status" | jq
```

Use chain/runtime verification where needed:

```bash
bun run --cwd packages/market-maker-bot verify:chains
bun run --cwd packages/simulation-dashboard scenario history
```

## Immediate Containment

1. Pause quote traffic on markets that are already settled.
2. Avoid additional admin restarts until claim state is inspected.

## Recovery Steps

1. Confirm the market is actually `RESOLVED` or `CANCELLED` in canonical lifecycle state.
2. Confirm on-chain position state still exists for affected users.
3. Restart the keeper if claimability is missing only in the backend surface.
4. Re-run the closest local Gate 10 flow if the bug is not obvious.
5. Drain claims only after verifying that repeated claims are rejected and cleanup occurs.

## Success Criteria

- claimable markets become visible again
- successful claims clear user exposure or refundable balances
- repeated claims are rejected
- backlog count stops increasing

## Escalation

Escalate if:

- claims remain blocked after backend recovery
- losing or refunded positions do not clear
- a protocol-level settlement invariant appears broken

## Evidence To Capture

- affected market refs and duel keys
- before/after lifecycle payloads
- user-facing claim errors
- on-chain tx refs or failed receipts
