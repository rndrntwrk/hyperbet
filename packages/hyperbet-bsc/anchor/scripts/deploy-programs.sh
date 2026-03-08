#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_CLUSTER="${1:-${SOLANA_DEPLOY_CLUSTER:-}}"
PROGRAMS=(
  "fight_oracle"
  "gold_clob_market"
  "gold_perps_market"
)

resolve_wallet_path() {
  local candidates=()

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

  printf 'No Anchor wallet found. Checked:\n' >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

if [[ -z "$TARGET_CLUSTER" ]]; then
  echo "usage: bash anchor/scripts/deploy-programs.sh <devnet|testnet|mainnet-beta>" >&2
  exit 1
fi

case "$TARGET_CLUSTER" in
  devnet|testnet|mainnet-beta) ;;
  mainnet)
    TARGET_CLUSTER="mainnet-beta"
    ;;
  *)
    echo "unsupported cluster: $TARGET_CLUSTER" >&2
    exit 1
    ;;
esac

for required in bun solana solana-keygen; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "missing required command: $required" >&2
    exit 1
  fi
done

WALLET_PATH="$(resolve_wallet_path)"
echo "[deploy] cluster: $TARGET_CLUSTER"
echo "[deploy] wallet:  $WALLET_PATH"
echo "[deploy] address: $(solana-keygen pubkey "$WALLET_PATH")"
echo "[deploy] balance: $(solana balance --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH")"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[deploy] building anchor workspace"
  bun run --cwd "$ROOT_DIR" build
fi

for program in "${PROGRAMS[@]}"; do
  keypair_path="$ROOT_DIR/target/deploy/${program}-keypair.json"
  binary_path="$ROOT_DIR/target/deploy/${program}.so"

  if [[ ! -f "$keypair_path" ]]; then
    echo "missing program keypair: $keypair_path" >&2
    exit 1
  fi
  if [[ ! -f "$binary_path" ]]; then
    echo "missing program binary: $binary_path" >&2
    exit 1
  fi

  program_id="$(solana-keygen pubkey "$keypair_path")"
  echo "[deploy] deploying $program ($program_id)"
  solana program deploy \
    --url "$TARGET_CLUSTER" \
    --keypair "$WALLET_PATH" \
    --program-id "$keypair_path" \
    "$binary_path"

  echo "[deploy] verifying $program ($program_id)"
  solana program show --url "$TARGET_CLUSTER" "$program_id"
done

echo "[deploy] complete"
