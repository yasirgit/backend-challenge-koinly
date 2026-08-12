# Crypto-tax backend skeleton

An architectural skeleton for the ingestion half of a crypto-tax product: an import is requested
over HTTP, queued, normalized by a worker, written to PostgreSQL, and read back. Two source
adapters run over fixtures, and the pipeline is safe to run twice.

The reasoning lives in [ARCHITECTURE.md](ARCHITECTURE.md); the scope in
[REQUIREMENTS.md](REQUIREMENTS.md); the decisions in [docs/adr/](docs/adr/README.md). The original
brief is [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md).

## Run it

Docker is the only prerequisite.

```bash
docker compose up --build -d --wait
```

That builds one image and starts PostgreSQL, RabbitMQ, a one-shot migration, a one-shot seed, the
API and the worker — in that order, each gated on the previous one being healthy or having exited
successfully. When the command returns, the system is ready; there is no second setup step.

- API: <http://localhost:3000> (`/healthz` for liveness, `/readyz` for dependencies)
- RabbitMQ management UI: <http://localhost:15672> (`koinly` / `koinly`)

## See it work

```bash
./scripts/demo.sh
```

The script requests an import, waits for the worker, prints the transactions, and then imports the
same payload again to show that nothing is written twice. To do it by hand:

```bash
USER=01900000-0000-7000-8000-00000000a001      # created by the seed service
WALLET=01900000-0000-7000-8000-0000000000d1    # an acme_exchange_csv wallet

# Request an import. 202 means accepted and queued.
curl -s -X POST localhost:3000/v1/imports \
  -H 'content-type: application/json' \
  -H "x-user-id: $USER" \
  -H 'idempotency-key: my-first-import' \
  -d "{\"walletId\":\"$WALLET\",\"payloadRef\":\"acme-exchange/trades.csv\"}"

# Poll until status is completed; counts show total / imported / skipped.
curl -s localhost:3000/v1/imports/<id> -H "x-user-id: $USER"

# Read the transactions back, newest first, with a keyset cursor.
curl -s "localhost:3000/v1/wallets/$WALLET/transactions?limit=5" -H "x-user-id: $USER"
```

Things worth trying, because each demonstrates a design decision rather than a feature:

| Try this | What it shows |
| --- | --- |
| Repeat the `POST` with the same `Idempotency-Key` | `200` and the original import, not a second one |
| Repeat it with a *new* key and the same file | `imported: 0, skipped: 8` — row identity is derived from content |
| Repeat it with the same key but a different body | `409`; the request is fingerprinted |
| Import `fake-chain/transfers.json` into wallet `…00d2` | A second source adapter, same pipeline |
| Import a `payloadRef` that does not exist | The import ends `failed` with a structured error, and the message is parked in `imports.dlq` |
| `docker compose up -d --scale worker=3` and import again | Three consumers, one set of rows |

The seeded user owns two wallets: `…0000d1` for the CSV exchange export and `…0000d2` for the JSON
chain payload. Fixtures live in [`fixtures/`](fixtures).

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/wallets` | Register a wallet for a source; repeating it returns the existing one |
| `POST` | `/v1/imports` | Accepts `Idempotency-Key`; `202` when queued, `200` on a replay |
| `GET` | `/v1/imports/:id` | Status, attempt count, row counts, structured error |
| `GET` | `/v1/wallets/:id/transactions` | Keyset pagination via `limit` and `cursor` |
| `GET` | `/healthz`, `/readyz` | Liveness, and readiness including PostgreSQL and RabbitMQ |

`x-user-id` stands in for an authenticated subject — see the skipped list in
[ARCHITECTURE.md](ARCHITECTURE.md#7-deliberately-skipped). Every response carries
`x-correlation-id`, echoed from the request when supplied, and it follows the work into the
worker's logs.

## Develop

Node 22 and pnpm 9.

```bash
pnpm install
pnpm check              # typecheck, lint, dependency rules, unit tests, compiled-artifact load

pnpm infra:up           # PostgreSQL and RabbitMQ for tests, on their own ports
pnpm test:integration   # repository contract against real Postgres, plus the end-to-end pipeline
pnpm infra:down
```

Running the services outside Docker: `cp .env.example .env`, then `pnpm migrate && pnpm seed`, then
`pnpm dev:api` and `pnpm dev:worker` in separate terminals.

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | `tsc -b`; also enforces the layer graph through project references |
| `pnpm lint` | Rules that protect invariants (no wall clock in the domain, no `process.env` outside config) |
| `pnpm depcruise` | Module-graph rules: no cycles, adapters never import use cases |
| `pnpm test` | Unit and use-case tests |
| `pnpm smoke` | Builds, then loads every compiled entrypoint under plain Node |

## Layout

```
packages/
  domain/          entities, value objects, invariants, normalization  (depends on nothing)
  application/     ports and use cases                                 (depends on domain)
  infrastructure/  PostgreSQL, RabbitMQ, sources, config, logging      (implements the ports)
  api/             HTTP entrypoint
  worker/          queue entrypoint
tests/e2e/         the one suite allowed to import both entrypoints
fixtures/          sample exchange and chain payloads
docker/            the image; docker-compose.yml is at the root
docs/adr/          twelve decision records
```
