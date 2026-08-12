#!/usr/bin/env bash
#
# The end-to-end walkthrough from the README, as one command.
#
# Requests an import, polls until the worker finishes, prints the transactions, then requests the
# same payload a second time to show that nothing is written twice. Assumes `docker compose up -d`
# has already run; the seed service created the user and wallets it uses.

set -euo pipefail

API="${API:-http://localhost:3000}"
USER_ID="${USER_ID:-01900000-0000-7000-8000-00000000a001}"
WALLET_ID="${WALLET_ID:-01900000-0000-7000-8000-0000000000d1}"
PAYLOAD="${PAYLOAD:-acme-exchange/trades.csv}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

request_import() {
  curl -sS -X POST "$API/v1/imports" \
    -H 'content-type: application/json' \
    -H "x-user-id: $USER_ID" \
    -H "idempotency-key: $1" \
    -d "{\"walletId\":\"$WALLET_ID\",\"payloadRef\":\"$PAYLOAD\"}"
}

import_id() { python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'; }

await_completion() {
  local id="$1"
  for _ in $(seq 1 60); do
    local body status
    body=$(curl -sS "$API/v1/imports/$id" -H "x-user-id: $USER_ID")
    status=$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
    if [ "$status" = 'completed' ] || [ "$status" = 'failed' ]; then
      printf '%s\n' "$body" | python3 -m json.tool
      return 0
    fi
    sleep 0.5
  done
  echo "import $id did not finish in 30s" >&2
  return 1
}

say '1. Readiness'
curl -sS "$API/readyz" | python3 -m json.tool

say '2. Request an import'
FIRST=$(request_import "demo-$(date +%s)" | tee /dev/stderr | import_id)

say '3. Wait for the worker'
await_completion "$FIRST"

say '4. Read the transactions back'
curl -sS "$API/v1/wallets/$WALLET_ID/transactions?limit=3" -H "x-user-id: $USER_ID" | python3 -m json.tool

say '5. Import the same payload again — every row is recognized and skipped'
SECOND=$(request_import "demo-replay-$(date +%s)" | import_id)
await_completion "$SECOND"
