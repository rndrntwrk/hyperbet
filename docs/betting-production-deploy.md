# Hyperbet Production Deploy (Cloudflare + Railway)

This is the recommended production topology for the Hyperbet stack in this repo.

- Primary frontend (`/packages/hyperbet-solana/app`): Cloudflare Pages (`hyperbet.win`)
- Secondary frontend (`/packages/hyperbet-bsc/app`): optional additional Pages project or subdomain
- Primary betting API (`/packages/hyperbet-solana/keeper`): Railway
- Secondary betting API (`/packages/hyperbet-bsc/keeper`): optional second Railway service if you split by chain
- Live duel/stream source (`/packages/server` or Vast duel stack): separate upstream that the keeper polls
- DDoS/WAF/edge cache: Cloudflare proxy in front of the betting API
- Contracts/state: Solana + EVM (configured by env vars below, proxied server-side)

## 1) Deploy the keeper to Railway

From repo root, deploy the keeper service path:

```bash
railway up packages/hyperbet-solana/keeper --path-as-root -s hyperbet-keeper
```

Use `packages/hyperbet-solana/keeper/railway.json`.

Set these Railway variables at minimum:

- `NODE_ENV=production`
- `PORT=8080` (or let Railway inject its port if you proxy through the service domain)
- `STREAM_STATE_SOURCE_URL=https://your-stream-source.example/api/streaming/state`
- `STREAM_STATE_SOURCE_BEARER_TOKEN=...` if the upstream streaming state is protected
- `ARENA_EXTERNAL_BET_WRITE_KEY=...`
- `STREAM_PUBLISH_KEY=...` if you use `/api/streaming/state/publish`
- `SOLANA_CLUSTER=mainnet-beta`
- `SOLANA_RPC_URL=...`
- `BSC_RPC_URL=...`
- `BSC_GOLD_CLOB_ADDRESS=...`
- `BASE_RPC_URL=...`
- `BASE_GOLD_CLOB_ADDRESS=...`
- `BIRDEYE_API_KEY=...` if token-price proxying is enabled

Persistence:

- The keeper defaults to a local SQLite file (`KEEPER_DB_PATH=./keeper.sqlite`).
- On Railway that file is ephemeral unless you attach a persistent volume or move the keeper state to an external database.
- Do not treat points history, referrals, or oracle history as durable unless persistence is configured explicitly.

Notes:

- The keeper serves the Pages app's read/write betting APIs. It is not the same process as the Hyperscape duel server.
- The keeper also proxies Solana and EVM JSON-RPC for the public app. Keep provider-keyed RPC URLs on Railway, not in Cloudflare Pages build vars.
- The keeper will return boot fallback duel data until `STREAM_STATE_SOURCE_URL` is set and the upstream duel server responds.
- The autonomous keeper bot also needs a funded signer wallet on Solana to create/resolve markets in production.

## 2) Deploy the live duel server / stream source

This can be the Railway `hyperscape` service or the Vast.ai duel stack. It must expose:

- `/api/streaming/state`
- `/api/streaming/duel-context`
- `/api/streaming/rtmp/status`
- `/live/stream.m3u8`

If you run the Vast.ai stack, verify it before pointing the keeper at it:

```bash
./scripts/check-streaming-status.sh http://127.0.0.1:5555
```

## 3) Put the betting API behind Cloudflare

1. Create `api.yourdomain.com` in Cloudflare DNS and point it to the keeper Railway target.
2. Enable Cloudflare proxy (orange cloud) for `api.yourdomain.com`.
3. Add WAF rate-limit rules:
- `POST /api/arena/bet/record-external`
- `POST /api/arena/deposit/ingest`
- `/api/arena/points/*`
4. Keep the direct Railway URL private if you introduce a public API domain.

## 4) Deploy frontend to Cloudflare Pages

Project root:

- `packages/hyperbet-solana/app`

Build/output:

- Build command: `bun install && bun run build --mode mainnet-beta`
- Output directory: `dist`

Frontend env vars (Cloudflare Pages):

- `VITE_GAME_API_URL=https://api.yourdomain.com`
- `VITE_GAME_WS_URL=wss://api.yourdomain.com/ws` if the keeper exposes websocket features you use
- `VITE_SOLANA_CLUSTER=mainnet-beta` (or testnet/devnet)
- `VITE_USE_GAME_RPC_PROXY=true`
- `VITE_USE_GAME_EVM_RPC_PROXY=true`
- `VITE_BSC_GOLD_CLOB_ADDRESS` / `VITE_BASE_GOLD_CLOB_ADDRESS`
- `VITE_BSC_GOLD_TOKEN_ADDRESS` / `VITE_BASE_GOLD_TOKEN_ADDRESS`
- `VITE_STREAM_SOURCES=https://your-hls-or-embed-source,...`

Do not set provider-keyed values in any `VITE_*RPC_URL` variable for production builds. The betting app build fails intentionally if a public RPC URL looks like a Helius / Alchemy / Infura / QuickNode / dRPC secret endpoint.

Cloudflare Pages headers/SPA rules are already added in:

- `packages/hyperbet-solana/app/public/_headers`
- `packages/hyperbet-solana/app/public/_redirects`

Deployment metadata:

- `build-info.json` is emitted into `dist/` on every build and should be served with `Cache-Control: no-store`.
## 5) Verify production

Health:

- `https://api.yourdomain.com/status`
- `https://bet.yourdomain.com`
- `https://api.yourdomain.com/api/streaming/state`
- `https://api.yourdomain.com/api/streaming/duel-context`
- `https://api.yourdomain.com/api/perps/markets`
- `https://api.yourdomain.com/api/proxy/evm/rpc?chain=bsc` (POST JSON-RPC smoke test)
- `https://bet.yourdomain.com/build-info.json`

End-to-end checks from repo root:

```bash
bun run duel:verify --server-url=https://your-stream-source.example --betting-url=https://bet.yourdomain.com --require-destinations=youtube
```

## 6) Security notes

- Do not expose `ARENA_EXTERNAL_BET_WRITE_KEY` in public frontend env vars.
- Do not ship provider-keyed RPC URLs in public frontend env vars. Keep them on Railway and let the keeper proxy them.
- Rotate all secrets before production if they were ever committed/shared.
- Keep `DISABLE_RATE_LIMIT` unset in production.
