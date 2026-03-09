#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$DEMO_DIR/anchor"
KEEPER_DIR="$DEMO_DIR/keeper"
EVM_DIR="$(cd "$DEMO_DIR/../evm-contracts" && pwd)"
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
SOLANA_DYNAMIC_PORT_START="${E2E_SOLANA_DYNAMIC_PORT_START:-$((SOLANA_RPC_PORT + 100))}"
SOLANA_DYNAMIC_PORT_END="${E2E_SOLANA_DYNAMIC_PORT_END:-$((SOLANA_DYNAMIC_PORT_START + 99))}"
LEDGER_DIR="${E2E_SOLANA_LEDGER_DIR:-/tmp/hyperbet-bsc-e2e-ledger-${SOLANA_RPC_PORT}}"
SOLANA_RPC_URL="http://127.0.0.1:${SOLANA_RPC_PORT}"
SOLANA_WS_URL="ws://127.0.0.1:${SOLANA_WS_PORT}"
SOLANA_PROXY_PORT="${E2E_SOLANA_PROXY_PORT:-19898}"
SOLANA_PROXY_URL="http://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_PROXY_WS_URL="ws://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_MINT_AUTHORITY="${E2E_SOLANA_MINT_AUTHORITY:-DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn}"
ANVIL_PORT="${E2E_EVM_PORT:-18545}"
# Always target the local anvil instance spawned by this script.
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EVM_CHAIN_ID="${E2E_EVM_CHAIN_ID:-31337}"
RUN_LOCK_DIR="$APP_DIR/.e2e-run.lock"
RUN_LOCK_PID_FILE="$RUN_LOCK_DIR/pid"

VALIDATOR_PID=""
ANVIL_PID=""
APP_PID=""
SOLANA_PROXY_PID=""
KEEPER_PID=""

resolve_wallet_path() {
  local candidates=()

  if [[ -n "${E2E_SOLANA_BOOTSTRAP_KEYPAIR:-}" ]]; then
    candidates+=("${E2E_SOLANA_BOOTSTRAP_KEYPAIR}")
  fi
  if [[ -n "${SOLANA_BOOTSTRAP_KEYPAIR:-}" ]]; then
    candidates+=("${SOLANA_BOOTSTRAP_KEYPAIR}")
  fi
  if [[ -n "${ANCHOR_WALLET:-}" ]]; then
    candidates+=("${ANCHOR_WALLET}")
  fi
  candidates+=(
    "$HOME/.config/solana/hyperscape-keys/deployer.json"
    "$HOME/.config/solana/id.json"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf '[e2e] no bootstrap wallet found\n' >&2
  exit 1
}

cleanup() {
  if [[ -f "$RUN_LOCK_PID_FILE" ]] && [[ "$(cat "$RUN_LOCK_PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -rf "$RUN_LOCK_DIR"
  fi
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

acquire_run_lock() {
  if mkdir "$RUN_LOCK_DIR" >/dev/null 2>&1; then
    printf '%s\n' "$$" >"$RUN_LOCK_PID_FILE"
    return 0
  fi

  local existing_pid=""
  if [[ -f "$RUN_LOCK_PID_FILE" ]]; then
    existing_pid="$(cat "$RUN_LOCK_PID_FILE" 2>/dev/null || true)"
  fi

  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    echo "[e2e] another local run is active for $APP_DIR (pid $existing_pid)" >&2
    exit 1
  fi

  rm -rf "$RUN_LOCK_DIR"
  mkdir "$RUN_LOCK_DIR"
  printf '%s\n' "$$" >"$RUN_LOCK_PID_FILE"
}

acquire_run_lock

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

read_solana_block_height() {
  local response
  local height

  response="$(curl -s -X POST "$SOLANA_RPC_URL" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getBlockHeight"}')"
  height="$(printf "%s" "$response" | jq -r '.result // empty')"
  if [[ ! "$height" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf "%s\n" "$height"
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

wait_for_solana_block_production() {
  local previous_height=""
  for _ in {1..120}; do
    local current_height
    if current_height="$(read_solana_block_height)"; then
      if [[ -n "$previous_height" && "$current_height" -gt "$previous_height" ]]; then
        return 0
      fi
      previous_height="$current_height"
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
  local pid="${2:-}"
  for _ in {1..90}; do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      return 1
    fi
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
  local attempt
  for attempt in {1..10}; do
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
    if [[ -z "$pids" ]]; then
      return 0
    fi
    if [[ "$attempt" -eq 1 ]]; then
      echo "[e2e] clearing existing listeners on :$port"
    fi
    for pid in $pids; do
      if [[ "$attempt" -lt 4 ]]; then
        kill "$pid" >/dev/null 2>&1 || true
      else
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    done
    sleep 1
  done

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[e2e] failed to clear listener on :$port" >&2
    exit 1
  fi
}

kill_stale_playwright() {
  pkill -f "$APP_DIR/node_modules/.bin/playwright test --config $APP_DIR/tests/e2e/playwright.config.ts" >/dev/null 2>&1 || true
  pkill -f "$APP_DIR/node_modules/playwright/lib/common/process.js" >/dev/null 2>&1 || true
}

kill_listeners "$APP_PORT"
kill_listeners "$GAME_API_PORT"
kill_listeners "$SOLANA_RPC_PORT"
kill_listeners "$SOLANA_WS_PORT"
kill_listeners "$SOLANA_FAUCET_PORT"
pkill -f "solana-test-validator .*--ledger $LEDGER_DIR" >/dev/null 2>&1 || true
pkill -f "anvil --silent --host 127.0.0.1 --port $ANVIL_PORT" >/dev/null 2>&1 || true
pkill -f "$APP_DIR/tests/e2e/setup-localnet.ts" >/dev/null 2>&1 || true
pkill -f "$APP_DIR/tests/e2e/setup-evm-local.ts" >/dev/null 2>&1 || true
kill_stale_playwright
pkill -f "packages/hyperbet-bsc/app/scripts/solana-rpc-proxy.mjs" >/dev/null 2>&1 || true
kill_listeners "$SOLANA_PROXY_PORT"
kill_listeners "$ANVIL_PORT"
rm -f "$KEEPER_DB_PATH" "${KEEPER_DB_PATH}-shm" "${KEEPER_DB_PATH}-wal"

echo "[e2e] building anchor programs"
bun run --cwd "$ANCHOR_DIR" build >/tmp/hyperbet-bsc-e2e-build.log 2>&1

echo "[e2e] compiling evm contracts"
bun run --cwd "$EVM_DIR" compile >/tmp/hyperbet-bsc-e2e-evm-build.log 2>&1

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
SOLANA_BOOTSTRAP_KEYPAIR="$(resolve_wallet_path)"
solana-test-validator \
  --reset \
  --quiet \
  --rpc-port "$SOLANA_RPC_PORT" \
  --faucet-port "$SOLANA_FAUCET_PORT" \
  --dynamic-port-range "${SOLANA_DYNAMIC_PORT_START}-${SOLANA_DYNAMIC_PORT_END}" \
  --mint "$SOLANA_MINT_AUTHORITY" \
  --ledger "$LEDGER_DIR" \
  --upgradeable-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_MARKET_ID" "$ANCHOR_DIR/target/deploy/gold_perps_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_CLOB_ID" "$ANCHOR_DIR/target/deploy/gold_clob_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
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
if ! wait_for_solana_block_production; then
  echo "[e2e] validator did not begin producing blocks"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
sleep 5

echo "[e2e] starting local solana rpc proxy"
env \
  SOLANA_RPC_TARGET="$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET="$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT="$SOLANA_PROXY_PORT" \
  node "$APP_DIR/scripts/solana-rpc-proxy.mjs" >"$SOLANA_PROXY_LOG" 2>&1 < /dev/null &
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
sleep 2

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
  bun run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 < /dev/null &
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
kill_listeners "$APP_PORT"
rm -rf "$APP_DIR/node_modules/.vite"
echo "[e2e] pre-bundling vite dependencies"
(
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/vite optimize --force --mode e2e
) >/tmp/hyperbet-bsc-e2e-vite-optimize.log 2>&1
(
  cd "$APP_DIR"
  exec env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/vite --mode e2e --port "$APP_PORT" --strictPort
) >"$APP_LOG" 2>&1 < /dev/null &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/" "$APP_PID"; then
  echo "[e2e] app did not become ready"
  tail -n 80 "$APP_LOG" || true
  exit 1
fi
sleep 2

echo "[e2e] running playwright tests"
(
  cd "$APP_DIR"
  env \
    E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
    E2E_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/playwright test \
      --config "$APP_DIR/tests/e2e/playwright.config.ts" \
      "$@"
)
