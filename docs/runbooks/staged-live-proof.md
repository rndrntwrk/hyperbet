# Staged Live Proof

Use this runbook to execute the manual staging proof rail for Gate 14A / Gate
23.

This runbook does **not** change production topology. It validates the staged
Solana, BSC, and AVAX rails using the same deployed shape as production:

- staged Solana Pages + staged Solana keeper
- staged BSC Pages + staged BSC keeper
- staged AVAX Pages + staged AVAX keeper
- external staged duel/stream source
- keeper-proxied RPC

## Symptoms

- You need to prove that the staged prediction-market stack is healthy before a
  reviewer or operator sign-off.
- You need machine-readable evidence for staged build, keeper, lifecycle,
  proxy, env-audit, and canary write behavior.

## Detection And Verification

Read-only proof surfaces:

- `https://<solana-pages>/build-info.json`
- `https://<solana-keeper>/status`
- `https://<solana-keeper>/api/arena/prediction-markets/active`
- `https://<solana-keeper>/api/keeper/bot-health`
- `https://<solana-keeper>/api/streaming/state`
- `https://<solana-keeper>/api/streaming/duel-context`
- `https://<bsc-pages>/build-info.json`
- `https://<bsc-keeper>/status`
- `https://<bsc-keeper>/api/arena/prediction-markets/active`
- `https://<bsc-keeper>/api/keeper/bot-health`
- `https://<avax-pages>/build-info.json`
- `https://<avax-keeper>/status`
- `https://<avax-keeper>/api/arena/prediction-markets/active`
- `https://<avax-keeper>/api/keeper/bot-health`

Repo-backed staging proof entrypoints:

```bash
bun run staged:proof -- --mode=read-only --target=all
bun run staged:proof -- --mode=canary-write --target=solana
bun run staged:proof -- --mode=canary-write --target=bsc
bun run staged:proof -- --mode=canary-write --target=avax
```

GitHub manual workflow:

- workflow: `Staged Live Proof`
- inputs:
  - `mode=read-only|canary-write`
  - `target=all|solana|bsc|avax`

## Immediate Containment

- If read-only proof fails, do **not** run canary writes.
- If canary-write fails on one chain, stop there and do not continue to the
  other chain until the failure is understood.
- If AVAX staging env audit fails, stop there and fix the staging contract
  before attempting canary writes.

## Exact Recovery Steps

1. Confirm the staging deployments exist and point at the intended URLs.
   Required workflow inputs and vars:
   - `HYPERBET_SOLANA_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_SOLANA_PAGES_STAGING_URL`
   - `HYPERBET_SOLANA_KEEPER_STAGING_URL`
   - `HYPERBET_SOLANA_KEEPER_STAGING_WS_URL`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_KEEPER_SERVICE_ID`
   - `HYPERBET_BSC_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_BSC_PAGES_STAGING_URL`
   - `HYPERBET_BSC_KEEPER_STAGING_URL`
   - `HYPERBET_BSC_KEEPER_STAGING_WS_URL`
   - `HYPERBET_BSC_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_BSC_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_BSC_RAILWAY_STAGING_KEEPER_SERVICE_ID`
   - `HYPERBET_AVAX_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_AVAX_PAGES_STAGING_URL`
   - `HYPERBET_AVAX_KEEPER_STAGING_URL`
   - `HYPERBET_AVAX_KEEPER_STAGING_WS_URL`
   - `HYPERBET_AVAX_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_AVAX_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_AVAX_RAILWAY_STAGING_KEEPER_SERVICE_ID`
2. Confirm proof secrets are present in the staging environment:
   - `HYPERBET_SOLANA_STAGING_RPC_URL`
   - `HYPERBET_BSC_STAGING_RPC_URL`
   - `HYPERBET_AVAX_STAGING_RPC_URL`
   - `HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_BSC_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_STAGED_PROOF_DUEL_ID`
   - `HYPERBET_STAGED_PROOF_DUEL_KEY`
   - `HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR`
   - `HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR`
   - `HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY`
   - `HYPERBET_BSC_STAGING_CANARY_PRIVATE_KEY`
   - `HYPERBET_BSC_STAGING_DUEL_ORACLE_ADDRESS`
   - `HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS`
   - `HYPERBET_AVAX_STAGING_REPORTER_PRIVATE_KEY`
   - `HYPERBET_AVAX_STAGING_CANARY_PRIVATE_KEY`
   - `HYPERBET_AVAX_STAGING_DUEL_ORACLE_ADDRESS`
   - `HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS`
   - `HYPERBET_AVAX_STAGING_CHAIN_ID`
3. Run `read-only` proof first.
4. If read-only succeeds, run `canary-write` separately for Solana, BSC, and
   AVAX.
5. Inspect the generated artifact bundle:
   - `.ci-artifacts/staged-live-proof/summary.json`
   - `solana/*`
   - `bsc/*`
   - `avax/*`
   - `verify-chains.json`
6. If a chain fails:
   - collect the failing payloads and tx hashes/signatures
   - verify the staged duel source and keeper `/status`
   - verify the keeper proxy paths
   - verify the canary wallet funds

## Success Criteria

- Solana read-only proof passes.
- BSC read-only proof passes.
- AVAX read-only proof passes.
- Solana canary write proof completes with visible lifecycle change and
  claim/refund cleanup.
- BSC canary write proof completes with visible lifecycle change and
  claim/refund cleanup.
- AVAX canary write proof completes with visible lifecycle change and
  claim/refund cleanup.
- `verify:chains` passes for Solana, BSC, and AVAX.
- AVAX staging app and keeper env audits pass.

## Escalation Criteria

- `build-info.json` does not match the deployed commit.
- `/status` is not healthy on a staged keeper.
- `/api/arena/prediction-markets/active` or `/api/keeper/bot-health` is
  inconsistent with the expected staged duel.
- A canary order lands on chain but lifecycle never reflects it.
- Claim/refund does not clear state after controlled cancel/resolve.
- AVAX staging env audit fails or points at the wrong chain or contract.

## Evidence To Capture Before Escalation

- full `summary.json` artifact
- the per-chain JSON payloads under `solana/`, `bsc/`, and `avax/`
- tx signatures/hashes for the canary writes
- `verify-chains.json`
- `avax/env-audit.json`
- staging deploy workflow run URLs
