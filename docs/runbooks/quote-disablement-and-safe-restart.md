# Quote Disablement And Safe Restart

## Symptoms

- MM quotes are stale, crossed, or obviously out of line with duel state
- `/api/keeper/bot-health` shows repeated failures, drawdown halts, or persistent restart loops
- `/status` is healthy but quote state is not converging

## Detection

```bash
curl -fsSL "$KEEPER_URL/status" | jq
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
curl -fsSL "$KEEPER_URL/api/arena/prediction-markets/active" | jq
bun run --cwd packages/market-maker-bot verify:chains
```

## Immediate Containment

1. Stop the external MM bot process for the affected chain set.
2. If the keeper bot is contributing bad liquidity, restart the keeper with bot execution disabled or paused by env/config.
3. Do not reopen quote traffic until `/api/keeper/bot-health` reports coherent market state and no active recovery reason.

## Recovery Steps

1. Verify RPC and chain reachability with `verify:chains`.
2. Confirm canonical lifecycle state on `/api/arena/prediction-markets/active`.
3. Restart the keeper service and wait for:
   - `/status.ok == true`
   - `/api/keeper/bot-health.ok == true`
   - market records present for the affected chain
4. Restart the external MM bot only after keeper health is stable.
5. Re-check that quote state and lifecycle state agree.

## Success Criteria

- `/status` is healthy
- `/api/keeper/bot-health` shows coherent market state with no unresolved recovery reason
- canonical prediction-market records are present and not regressing
- quotes resume only on open markets

## Escalation

Escalate if:

- repeated restart loops continue after quote disablement
- the keeper recreates or duplicates market state
- claimability or lifecycle status diverges after restart

## Evidence To Capture

- `/status` payload
- `/api/keeper/bot-health` payload
- `/api/arena/prediction-markets/active` payload
- MM bot logs
- keeper logs
