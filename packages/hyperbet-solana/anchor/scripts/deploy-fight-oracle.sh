#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_CLUSTER="${1:-${SOLANA_DEPLOY_CLUSTER:-}}"
PROGRAM="fight_oracle"

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

  printf 'No Solana deploy wallet found. Checked:\n' >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

if [[ -z "$TARGET_CLUSTER" ]]; then
  echo "usage: bash anchor/scripts/deploy-fight-oracle.sh <devnet|testnet|mainnet-beta>" >&2
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
KEYPAIR_PATH="$ROOT_DIR/target/deploy/${PROGRAM}-keypair.json"
BINARY_PATH="$ROOT_DIR/target/deploy/${PROGRAM}.so"

if [[ ! -f "$KEYPAIR_PATH" ]]; then
  echo "missing program keypair: $KEYPAIR_PATH" >&2
  exit 1
fi
if [[ ! -f "$BINARY_PATH" ]]; then
  echo "missing program binary: $BINARY_PATH" >&2
  exit 1
fi

echo "[deploy] cluster: $TARGET_CLUSTER"
echo "[deploy] wallet:  $WALLET_PATH"
echo "[deploy] address: $(solana-keygen pubkey "$WALLET_PATH")"
echo "[deploy] balance: $(solana balance --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH")"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[deploy] building anchor workspace"
  bun run --cwd "$ROOT_DIR" build
fi

PROGRAM_ID="$(solana-keygen pubkey "$KEYPAIR_PATH")"
echo "[deploy] deploying $PROGRAM ($PROGRAM_ID)"
solana program deploy \
  --url "$TARGET_CLUSTER" \
  --keypair "$WALLET_PATH" \
  --program-id "$KEYPAIR_PATH" \
  "$BINARY_PATH"

echo "[deploy] verifying $PROGRAM ($PROGRAM_ID)"
solana program show --url "$TARGET_CLUSTER" "$PROGRAM_ID"

echo "[deploy] complete"
