#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <target> [<target> ...]" >&2
  exit 1
fi

resolve_cwd() {
  case "$1" in
    root)
      echo "."
      ;;
    hyperbet-solana-app)
      echo "packages/hyperbet-solana/app"
      ;;
    hyperbet-solana-keeper)
      echo "packages/hyperbet-solana/keeper"
      ;;
    hyperbet-bsc-app)
      echo "packages/hyperbet-bsc/app"
      ;;
    hyperbet-bsc-keeper)
      echo "packages/hyperbet-bsc/keeper"
      ;;
    hyperbet-avax-app)
      echo "packages/hyperbet-avax/app"
      ;;
    hyperbet-avax-keeper)
      echo "packages/hyperbet-avax/keeper"
      ;;
    market-maker-bot)
      echo "packages/market-maker-bot"
      ;;
    evm-contracts)
      echo "packages/evm-contracts"
      ;;
    *)
      echo "unsupported install target: $1" >&2
      exit 1
      ;;
  esac
}

resolve_lockfile() {
  local cwd="$1"

  if [[ "$cwd" == "." ]]; then
    echo "bun.lock"
  elif [[ -f "$ROOT_DIR/$cwd/bun.lock" ]]; then
    echo "$cwd/bun.lock"
  else
    echo "bun.lock"
  fi
}

verify_lockfile_clean() {
  local lockfile="$1"

  if ! git -C "$ROOT_DIR" diff --exit-code -- "$lockfile" >/dev/null; then
    echo "Lockfile drift detected after install: $lockfile" >&2
    git -C "$ROOT_DIR" diff -- "$lockfile" >&2 || true
    exit 1
  fi
}

install_target() {
  local target="$1"
  local cwd
  local lockfile

  cwd="$(resolve_cwd "$target")"
  lockfile="$(resolve_lockfile "$cwd")"

  if [[ "$cwd" == "." ]]; then
    bun install
  else
    bun install --cwd "$ROOT_DIR/$cwd"
  fi

  verify_lockfile_clean "$lockfile"
}

for target in "$@"; do
  install_target "$target"
done
