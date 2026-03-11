#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
CONTROL_PATH="${2:-}"
SERVICE="${3:-}"

if [[ -z "$ACTION" || -z "$CONTROL_PATH" || -z "$SERVICE" ]]; then
  echo "usage: $0 <start|stop|restart> <control-path> <service>" >&2
  exit 1
fi

if [[ ! -f "$CONTROL_PATH" ]]; then
  echo "missing control file: $CONTROL_PATH" >&2
  exit 1
fi

service_json_path=".services[\"$SERVICE\"]"
service_exists="$(jq -r "${service_json_path} != null" "$CONTROL_PATH")"
if [[ "$service_exists" != "true" ]]; then
  echo "service \"$SERVICE\" is not defined in $CONTROL_PATH" >&2
  exit 1
fi

read_service_field() {
  local field="$1"
  jq -r "${service_json_path}.${field} // empty" "$CONTROL_PATH"
}

pid_file="$(read_service_field "pidFile")"
env_file="$(read_service_field "envFile")"
log_path="$(read_service_field "logPath")"
cwd_path="$(read_service_field "cwd")"
health_url="$(read_service_field "healthUrl")"
rpc_url="$(read_service_field "rpcUrl")"
app_dir="$(jq -r '.appDir // empty' "$CONTROL_PATH")"

require_file() {
  local label="$1"
  local path="$2"
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "missing ${label}: ${path:-<empty>}" >&2
    exit 1
  fi
}

pid_from_file() {
  if [[ -f "$pid_file" ]]; then
    cat "$pid_file" 2>/dev/null || true
  fi
}

stop_service() {
  local pid
  pid="$(pid_from_file)"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  for _ in {1..5}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      return 0
    fi
    sleep 1
  done

  echo "failed to stop service \"$SERVICE\" (pid $pid)" >&2
  exit 1
}

wait_for_keeper() {
  for _ in {1..90}; do
    if curl -s -o /dev/null -w "%{http_code}" "$health_url" | rg -q "200"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_proxy() {
  for _ in {1..90}; do
    if curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' | rg -q '"solana-core"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_anvil() {
  for _ in {1..90}; do
    if curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | rg -q '"result"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_keeper() {
  require_file "keeper env file" "$env_file"
  mkdir -p "$(dirname "$log_path")"
  nohup bash -lc "set -a; source \"$env_file\"; set +a; bun run --cwd \"$cwd_path\" service" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_keeper; then
    echo "keeper did not become ready after restart" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
}

start_solana_proxy() {
  require_file "proxy env file" "$env_file"
  if [[ -z "$app_dir" ]]; then
    echo "missing appDir in $CONTROL_PATH" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$log_path")"
  nohup bash -lc "set -a; source \"$env_file\"; set +a; node \"$app_dir/scripts/solana-rpc-proxy.mjs\"" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_solana_proxy; then
    echo "solana proxy did not become ready after restart" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
}

start_anvil() {
  require_file "anvil env file" "$env_file"
  mkdir -p "$(dirname "$log_path")"
  nohup bash -lc "set -a; source \"$env_file\"; set +a; anvil --silent --host 127.0.0.1 --port \"\$ANVIL_PORT\" --chain-id \"\$EVM_CHAIN_ID\" --state \"\$ANVIL_STATE_PATH\"" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_anvil; then
    echo "anvil did not become ready after restart" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
}

start_service() {
  case "$SERVICE" in
    keeper)
      start_keeper
      ;;
    solanaProxy)
      start_solana_proxy
      ;;
    anvil)
      start_anvil
      ;;
    *)
      echo "unsupported service \"$SERVICE\"" >&2
      exit 1
      ;;
  esac
}

case "$ACTION" in
  start)
    stop_service
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  *)
    echo "unsupported action \"$ACTION\"" >&2
    exit 1
    ;;
esac
