#!/usr/bin/env bash
set -euo pipefail

python3 -m http.server 6006 -d storybook-static --bind 127.0.0.1 >/tmp/hyperbet-ui-storybook-http.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:6006/index.json >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

node ./scripts/capture-storybook-screenshots.mjs
