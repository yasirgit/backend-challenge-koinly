#!/usr/bin/env bash
#
# Exercises every endpoint and every documented error path against a running stack, printing one
# PASS/FAIL line per case. Not part of the test suite: the automated coverage lives in
# tests/e2e, and this is the manual sweep used before a release or a demo.

set -uo pipefail

API="${API:-http://localhost:3000}"
USER_ID="${USER_ID:-01900000-0000-7000-8000-00000000a001}"
OTHER_USER="${OTHER_USER:-01900000-0000-7000-8000-00000000a002}"
WALLET="${WALLET:-01900000-0000-7000-8000-0000000000d1}"
CHAIN_WALLET="${CHAIN_WALLET:-01900000-0000-7000-8000-0000000000d2}"

pass=0
fail=0

# Runs a request and compares the status code, printing the body when it disagrees.
check() {
  local name="$1" expected="$2"
  shift 2
  local out status body
  out=$(curl -sS -w '\n%{http_code}' "$@" 2>&1)
  status=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')

  if [ "$status" = "$expected" ]; then
    printf '  PASS  %-58s %s\n' "$name" "$status"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-58s expected %s, got %s\n' "$name" "$expected" "$status"
    printf '        %s\n' "$(printf '%s' "$body" | head -c 300)"
    fail=$((fail + 1))
  fi
  LAST_BODY="$body"
}

json() { printf '%s' "$LAST_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

echo
echo 'Health and readiness'
check 'GET /healthz' 200 "$API/healthz"
check 'GET /readyz' 200 "$API/readyz"

echo
echo 'Wallets'
REF="apicheck-$(date +%s)-$RANDOM"
check 'POST /v1/wallets creates' 201 -X POST "$API/v1/wallets" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" \
  -d "{\"sourceType\":\"acme_exchange_csv\",\"sourceAccountRef\":\"$REF\",\"label\":\"API check\"}"
NEW_WALLET=$(json "['id']")

check 'POST /v1/wallets is idempotent on identity' 200 -X POST "$API/v1/wallets" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" \
  -d "{\"sourceType\":\"acme_exchange_csv\",\"sourceAccountRef\":\"$REF\",\"label\":\"API check\"}"

# 400, not 422: an unrecognized source is a problem with the request's content, and the error map
# reserves 422 for a well-formed request that breaks a business rule (see api/src/http/errors.ts).
check 'POST /v1/wallets rejects an unknown source' 400 -X POST "$API/v1/wallets" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" \
  -d "{\"sourceType\":\"not_a_source\",\"sourceAccountRef\":\"$REF-x\"}"

check 'POST /v1/wallets rejects a missing field' 400 -X POST "$API/v1/wallets" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -d '{"sourceType":"acme_exchange_csv"}'

check 'POST /v1/wallets rejects a missing user' 400 -X POST "$API/v1/wallets" \
  -H 'content-type: application/json' \
  -d "{\"sourceType\":\"acme_exchange_csv\",\"sourceAccountRef\":\"$REF-y\"}"

echo
echo 'Imports'
KEY="apicheck-$(date +%s)-$RANDOM"
check 'POST /v1/imports queues work' 202 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -H "idempotency-key: $KEY" \
  -d "{\"walletId\":\"$WALLET\",\"payloadRef\":\"acme-exchange/trades.csv\"}"
IMPORT_ID=$(json "['id']")

check 'POST /v1/imports replays the same key' 200 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -H "idempotency-key: $KEY" \
  -d "{\"walletId\":\"$WALLET\",\"payloadRef\":\"acme-exchange/trades.csv\"}"
[ "$(json "['id']")" = "$IMPORT_ID" ] \
  && { echo '  PASS  replay returned the original import id'; pass=$((pass + 1)); } \
  || { echo '  FAIL  replay returned a different import id'; fail=$((fail + 1)); }

check 'POST /v1/imports rejects a reused key with a new body' 409 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -H "idempotency-key: $KEY" \
  -d "{\"walletId\":\"$CHAIN_WALLET\",\"payloadRef\":\"fake-chain/transfers.json\"}"

check 'POST /v1/imports rejects a missing idempotency key' 400 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" \
  -d "{\"walletId\":\"$WALLET\",\"payloadRef\":\"acme-exchange/trades.csv\"}"

check 'POST /v1/imports rejects a malformed wallet id' 400 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -H "idempotency-key: $KEY-bad" \
  -d '{"walletId":"not-a-uuid","payloadRef":"acme-exchange/trades.csv"}'

check 'POST /v1/imports rejects an unknown wallet' 404 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $USER_ID" -H "idempotency-key: $KEY-missing" \
  -d '{"walletId":"01900000-0000-7000-8000-0000000000ff","payloadRef":"acme-exchange/trades.csv"}'

check "POST /v1/imports rejects another tenant's wallet" 404 -X POST "$API/v1/imports" \
  -H 'content-type: application/json' -H "x-user-id: $OTHER_USER" -H "idempotency-key: $KEY-tenant" \
  -d "{\"walletId\":\"$WALLET\",\"payloadRef\":\"acme-exchange/trades.csv\"}"

check 'GET /v1/imports/:id' 200 "$API/v1/imports/$IMPORT_ID" -H "x-user-id: $USER_ID"
check 'GET /v1/imports/:id is scoped to its owner' 404 "$API/v1/imports/$IMPORT_ID" -H "x-user-id: $OTHER_USER"
check 'GET /v1/imports/:id rejects a malformed id' 400 "$API/v1/imports/nope" -H "x-user-id: $USER_ID"
check 'GET /v1/imports/:id 404s an unknown id' 404 \
  "$API/v1/imports/01900000-0000-7000-8000-0000000000ff" -H "x-user-id: $USER_ID"

echo
echo 'Transactions'
check 'GET transactions' 200 "$API/v1/wallets/$WALLET/transactions" -H "x-user-id: $USER_ID"
check 'GET transactions honours limit' 200 "$API/v1/wallets/$WALLET/transactions?limit=2" -H "x-user-id: $USER_ID"
CURSOR=$(json "['nextCursor']")
check 'GET transactions follows a cursor' 200 \
  "$API/v1/wallets/$WALLET/transactions?limit=2&cursor=$CURSOR" -H "x-user-id: $USER_ID"
check 'GET transactions rejects an over-large limit' 400 \
  "$API/v1/wallets/$WALLET/transactions?limit=500" -H "x-user-id: $USER_ID"
check 'GET transactions rejects a corrupt cursor' 400 \
  "$API/v1/wallets/$WALLET/transactions?cursor=not-base64" -H "x-user-id: $USER_ID"
check 'GET transactions is scoped to its owner' 404 \
  "$API/v1/wallets/$WALLET/transactions" -H "x-user-id: $OTHER_USER"
check 'GET transactions on an empty wallet' 200 \
  "$API/v1/wallets/$NEW_WALLET/transactions" -H "x-user-id: $USER_ID"

echo
echo 'Routing'
check 'GET an unknown route' 404 "$API/v1/nope" -H "x-user-id: $USER_ID"

echo
echo 'Correlation'
CID="correlation-$(date +%s)"
ECHOED=$(curl -sS -D - -o /dev/null "$API/healthz" -H "x-correlation-id: $CID" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="x-correlation-id"{print $2}')
[ "$ECHOED" = "$CID" ] \
  && { echo '  PASS  x-correlation-id is echoed back'; pass=$((pass + 1)); } \
  || { echo "  FAIL  x-correlation-id: sent $CID, got ${ECHOED:-none}"; fail=$((fail + 1)); }

echo
printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
