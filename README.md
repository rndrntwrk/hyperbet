# Hyperbet

Private monorepo for Hyperbet betting, gambling, and futures products.

## Deployment structure

Verified on 2026-04-14.

- Keeper services deploy through Railway configs in `packages/hyperbet-solana/`, `packages/hyperbet-bsc/`, `packages/hyperbet-avax/`, and `packages/hyperbet-evm/`.
- Those Railway configs use `keeper/Dockerfile`, start with `bun --bun src/service.ts`, and health check `/status`.
- Package app Cloudflare configs exist at `packages/*/app/wrangler.toml`.
- Root package scripts expose deploy entry points: `deploy:pages`, `deploy:pages:solana`, `deploy:pages:bsc`, `deploy:pages:avax`, `deploy:keeper`, `deploy:keeper:solana`, `deploy:keeper:bsc`, and `deploy:keeper:avax`.
- The detailed production runbook remains `docs/hyperbet-production-deploy.md`.

The local-only 555stream runbook at `555/internal-ops-docs/deploy/DEPLOY_GIT_AUTH_RUNBOOK.md` does not operate Hyperbet. It is cross-project operational context only.

## Packages

- `packages/hyperbet-chain-registry`: shared chain/deployment registry for Solana and EVM prediction markets.
- `packages/hyperbet-solana`: Solana-focused betting stack copied from the current betting workspace.
- `packages/hyperbet-bsc`: BSC-focused betting stack copied from the current betting workspace.
- `packages/hyperbet-avax`: Avalanche-focused betting shell and keeper.
- `packages/evm-contracts`: Hyperbet-owned EVM contracts for CLOB and futures flows.
- `packages/market-maker-bot`: optional automated market-maker and wallet export tooling for Hyperbet environments.

## Relationship To Hyperscape

The game stays in the `hyperscape` monorepo.

Hyperbet consumes duel arena oracle artifacts published from Hyperscape:

- Solana oracle IDL/types
- EVM duel outcome oracle ABI/artifacts

## Commands

```bash
bun run dev:doctor
bun run dev:bootstrap
bun run build
bun run dev:solana
bun run dev:bsc
bun run dev:avax
bun run dev:local:solana
bun run dev:local:bsc
bun run dev:local:avax
```

Deployment runbook:

- `docs/hyperbet-production-deploy.md`
- `docs/development-setup.md`
- `docs/enoomian-prediction-market-sprint.md`
