#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$DEMO_DIR/anchor"
KEEPER_DIR="$DEMO_DIR/keeper"
EVM_DIR="$(cd "$DEMO_DIR/../evm-contracts" && pwd)"
LEDGER_DIR="${E2E_SOLANA_LEDGER_DIR:-/tmp/hyperscape-gold-e2e-ledger}"
VALIDATOR_LOG="$APP_DIR/.e2e-validator.log"
ANVIL_LOG="$APP_DIR/.e2e-anvil.log"
APP_LOG="$APP_DIR/.e2e-app.log"
SOLANA_PROXY_LOG="$APP_DIR/.e2e-solana-proxy.log"
KEEPER_LOG="$APP_DIR/.e2e-keeper.log"
PROGRAM_ORACLE_ID="6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD"
PROGRAM_MARKET_ID="HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik"
PROGRAM_CLOB_ID="ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi"
APP_PORT="${E2E_APP_PORT:-4181}"
GAME_API_PORT="${E2E_GAME_API_PORT:-5555}"
GAME_API_URL="http://127.0.0.1:${GAME_API_PORT}"
KEEPER_DB_PATH="${E2E_KEEPER_DB_PATH:-$APP_DIR/.e2e-keeper.sqlite}"
SOLANA_RPC_PORT="${E2E_SOLANA_RPC_PORT:-18899}"
SOLANA_WS_PORT="${E2E_SOLANA_WS_PORT:-18900}"
SOLANA_FAUCET_PORT="${E2E_SOLANA_FAUCET_PORT:-18901}"
SOLANA_RPC_URL="http://127.0.0.1:${SOLANA_RPC_PORT}"
SOLANA_WS_URL="ws://127.0.0.1:${SOLANA_WS_PORT}"
SOLANA_PROXY_PORT="${E2E_SOLANA_PROXY_PORT:-$((20000 + RANDOM % 10000))}"
SOLANA_PROXY_URL="http://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_PROXY_WS_URL="ws://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_MINT_AUTHORITY="${E2E_SOLANA_MINT_AUTHORITY:-DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn}"
ANVIL_PORT="${E2E_EVM_PORT:-18545}"
# Always target the local anvil instance spawned by this script.
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EVM_CHAIN_ID="${E2E_EVM_CHAIN_ID:-31337}"

VALIDATOR_PID=""
ANVIL_PID=""
APP_PID=""
SOLANA_PROXY_PID=""
KEEPER_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$KEEPER_PID" ]] && kill -0 "$KEEPER_PID" >/dev/null 2>&1; then
    kill "$KEEPER_PID" >/dev/null 2>&1 || true
    wait "$KEEPER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SOLANA_PROXY_PID" ]] && kill -0 "$SOLANA_PROXY_PID" >/dev/null 2>&1; then
    kill "$SOLANA_PROXY_PID" >/dev/null 2>&1 || true
    wait "$SOLANA_PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_solana_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}' | rg -q '"blockhash"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_ws() {
  for _ in {1..90}; do
    if (exec 3<>"/dev/tcp/127.0.0.1/${SOLANA_WS_PORT}") >/dev/null 2>&1; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_proxy() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_PROXY_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' | rg -q '"solana-core"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_anvil_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$ANVIL_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | rg -q '"result"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

read_anvil_chain_id() {
  local response
  local chain_id_hex

  response="$(curl -s -X POST "$ANVIL_RPC_URL" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}')"
  chain_id_hex="$(printf "%s" "$response" | jq -r '.result // empty')"
  if [[ ! "$chain_id_hex" =~ ^0x[0-9a-fA-F]+$ ]]; then
    return 1
  fi

  printf "%d\n" "$((16#${chain_id_hex#0x}))"
}

wait_for_app() {
  local url="$1"
  for _ in {1..90}; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | rg -q "200"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

run_with_retries() {
  local label="$1"
  local attempts="$2"
  shift 2

  local attempt=1
  while (( attempt <= attempts )); do
    if "$@"; then
      return 0
    fi

    if (( attempt == attempts )); then
      echo "[e2e] ${label} failed after ${attempts} attempts"
      return 1
    fi

    echo "[e2e] ${label} failed, retrying (${attempt}/${attempts})"
    sleep 2
    attempt=$((attempt + 1))
  done
}

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "[e2e] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
}

kill_listeners "$APP_PORT"
kill_listeners "$GAME_API_PORT"
kill_listeners "$SOLANA_RPC_PORT"
kill_listeners "$SOLANA_WS_PORT"
kill_listeners "$SOLANA_FAUCET_PORT"
pkill -f "packages/hyperbet-solana/app/scripts/solana-rpc-proxy.mjs" >/dev/null 2>&1 || true
kill_listeners "$SOLANA_PROXY_PORT"
kill_listeners "$ANVIL_PORT"
rm -f "$KEEPER_DB_PATH" "${KEEPER_DB_PATH}-shm" "${KEEPER_DB_PATH}-wal"

echo "[e2e] building anchor programs"
bun run --cwd "$ANCHOR_DIR" build >/tmp/hyperbet-solana-e2e-build.log 2>&1

echo "[e2e] compiling evm contracts"
bun run --cwd "$EVM_DIR" compile >/tmp/hyperbet-solana-e2e-evm-build.log 2>&1

IDL_ORACLE_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/fight_oracle.json" 2>/dev/null || true)"
IDL_MARKET_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/gold_perps_market.json" 2>/dev/null || true)"
IDL_CLOB_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/gold_clob_market.json" 2>/dev/null || true)"
if [[ -n "$IDL_ORACLE_ID" && "$IDL_ORACLE_ID" != "null" ]]; then
  PROGRAM_ORACLE_ID="$IDL_ORACLE_ID"
fi
if [[ -n "$IDL_MARKET_ID" && "$IDL_MARKET_ID" != "null" ]]; then
  PROGRAM_MARKET_ID="$IDL_MARKET_ID"
fi
if [[ -n "$IDL_CLOB_ID" && "$IDL_CLOB_ID" != "null" ]]; then
  PROGRAM_CLOB_ID="$IDL_CLOB_ID"
fi

echo "[e2e] starting local validator"
rm -rf "$LEDGER_DIR"
solana-test-validator \
  --reset \
  --quiet \
  --rpc-port "$SOLANA_RPC_PORT" \
  --faucet-port "$SOLANA_FAUCET_PORT" \
  --mint "$SOLANA_MINT_AUTHORITY" \
  --ledger "$LEDGER_DIR" \
  --bpf-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" \
  --bpf-program "$PROGRAM_MARKET_ID" "$ANCHOR_DIR/target/deploy/gold_perps_market.so" \
  --bpf-program "$PROGRAM_CLOB_ID" "$ANCHOR_DIR/target/deploy/gold_clob_market.so" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID="$!"

if ! wait_for_solana_rpc; then
  echo "[e2e] validator did not become ready"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
if ! wait_for_solana_ws; then
  echo "[e2e] validator websocket did not become ready"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
sleep 2

echo "[e2e] starting local solana rpc proxy"
env \
  SOLANA_RPC_TARGET="$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET="$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT="$SOLANA_PROXY_PORT" \
  node "$APP_DIR/scripts/solana-rpc-proxy.mjs" >"$SOLANA_PROXY_LOG" 2>&1 &
SOLANA_PROXY_PID="$!"

if ! wait_for_solana_proxy; then
  echo "[e2e] solana proxy did not become ready"
  tail -n 80 "$SOLANA_PROXY_LOG" || true
  exit 1
fi

echo "[e2e] starting local anvil"
anvil \
  --silent \
  --host 127.0.0.1 \
  --port "$ANVIL_PORT" \
  --chain-id "$EVM_CHAIN_ID" \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"

if ! wait_for_anvil_rpc; then
  echo "[e2e] anvil did not become ready"
  tail -n 80 "$ANVIL_LOG" || true
  exit 1
fi

if ACTUAL_EVM_CHAIN_ID="$(read_anvil_chain_id)"; then
  if [[ "$ACTUAL_EVM_CHAIN_ID" != "$EVM_CHAIN_ID" ]]; then
    echo "[e2e] anvil reported chain id ${ACTUAL_EVM_CHAIN_ID} (requested ${EVM_CHAIN_ID})"
  fi
  EVM_CHAIN_ID="$ACTUAL_EVM_CHAIN_ID"
else
  echo "[e2e] failed to read anvil chain id; continuing with configured ${EVM_CHAIN_ID}"
fi

echo "[e2e] seeding local solana state + writing .env.e2e"
run_with_retries \
  "solana e2e setup" \
  3 \
  env \
    E2E_SOLANA_RPC_URL="$SOLANA_RPC_URL" \
    E2E_SOLANA_WS_URL="$SOLANA_WS_URL" \
    E2E_BROWSER_SOLANA_RPC_URL="$SOLANA_PROXY_URL" \
    E2E_BROWSER_SOLANA_WS_URL="$SOLANA_PROXY_WS_URL" \
    bun run "$APP_DIR/tests/e2e/setup-localnet.ts"

echo "[e2e] seeding local evm state + extending .env.e2e"
run_with_retries \
  "evm e2e setup" \
  3 \
  env \
    E2E_EVM_RPC_URL="$ANVIL_RPC_URL" \
    E2E_EVM_CHAIN_ID="$EVM_CHAIN_ID" \
    bun run "$APP_DIR/tests/e2e/setup-evm-local.ts"

echo "[e2e] seeding keeper database"
env \
  KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  bun run "$APP_DIR/tests/e2e/setup-api-local.ts"

echo "[e2e] starting keeper api on :$GAME_API_PORT"
env \
  PORT="$GAME_API_PORT" \
  KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  ENABLE_KEEPER_BOT=false \
  bun run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 &
KEEPER_PID="$!"

if ! wait_for_app "$GAME_API_URL/status"; then
  echo "[e2e] keeper api did not become ready"
  tail -n 80 "$KEEPER_LOG" || true
  exit 1
fi

echo "[e2e] seeding keeper live api state"
env \
  E2E_GAME_API_URL="$GAME_API_URL" \
  bun run "$APP_DIR/tests/e2e/seed-api-local.ts"

echo "[e2e] starting app on :$APP_PORT"
(
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/vite --mode e2e --port "$APP_PORT" --strictPort
) >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e] app did not become ready"
  tail -n 80 "$APP_LOG" || true
  exit 1
fi

echo "[e2e] running playwright tests"
E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
E2E_GAME_API_URL="$GAME_API_URL" \
  bunx playwright test --config "$APP_DIR/tests/e2e/playwright.config.ts" "$@"
