# Requirements

This document states what the skeleton must do, what it deliberately does not do, and the
assumptions I made where the brief left room for interpretation. Every functional requirement is
phrased so that a test can prove or disprove it; the traceability section at the end maps each one
to the test that does.

## 1. Functional requirements

**FR-1 — Wallet registration.** A wallet can be created for a user against a named source. The pair
`(user, source type, source account reference)` identifies a wallet uniquely; re-registering the
same triple returns the existing wallet rather than creating a second one.

**FR-2 — Import intake is idempotent per key.** `POST /v1/imports` accepts an import request and
returns `202` with an import identifier. Repeating the request with the same `Idempotency-Key`
returns the same import and does not create a second one. Reusing a key with a *different* request
body is a conflict, not a silent no-op.

**FR-3 — Intake is asynchronous.** The intake request persists an import record and enqueues a job;
it does not parse, normalize or persist transactions inline. The response is returned before the
work is done.

**FR-4 — A queued import is processed to completion.** A worker consumes the job, reads the source
payload, normalizes it, persists the resulting transactions, and moves the import to a terminal
state (`completed` or `failed`) with row counts.

**FR-5 — Normalization is deterministic.** Given identical source bytes, normalization produces
identical output: the same transactions, in the same order, with the same natural keys and the same
quantities. No clock, no randomness, no map-iteration order may influence the result.

**FR-6 — Processing is idempotent end to end.** Delivering the same job message twice — or replaying
an import — results in exactly the same rows in the database as processing it once. No duplicates,
no double-counted balances.

**FR-7 — Genuine duplicates are preserved.** Two distinct source rows that happen to be identical in
every field (same second, same assets, same amounts) are stored as two transactions, not collapsed
into one. Idempotency must not become data loss.

**FR-8 — Monetary values survive the round trip exactly.** A quantity written to the database comes
back byte-identical, including 18 decimal places and 20-digit integer parts. No value passes through
an IEEE-754 double at any layer, including the driver and JSON serialization.

**FR-9 — Transactions are multi-leg.** A trade is stored as separate incoming, outgoing and fee legs,
each with its own asset and a strictly positive quantity. Direction is carried by the leg, not by
the sign of the amount.

**FR-10 — Transactions are readable back.** `GET /v1/wallets/:walletId/transactions` returns the
wallet's transactions with their legs, newest first, keyset-paginated, in a stable and deterministic
order.

**FR-11 — Import status is observable.** `GET /v1/imports/:importId` reports the current state,
attempt count, row counts and, for failures, a structured error.

**FR-12 — Failures are bounded and visible.** A transient failure is retried with a delay up to a
configured maximum attempt count. A permanent failure — malformed payload, unknown source, unknown
asset — fails immediately without consuming retries. Exhausted or permanently failed messages land
in a dead-letter queue and the import is marked `failed`.

**FR-13 — A crashed worker does not lose or corrupt an import.** An unacknowledged message is
redelivered and reprocessed; concurrent delivery of the same import to two workers is mutually
excluded, and the outcome is identical to a single clean run.

**FR-14 — Liveness and readiness are exposed.** `/healthz` reports process liveness.
`/readyz` reports whether the service can serve its primary function.

**FR-15 — One command starts everything.** `docker compose up` brings up the database, the broker,
applies migrations, seeds demo data, and starts the API and the worker, with no other local setup.

## 2. Non-functional requirements

**NFR-1 — TypeScript in strict mode**, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
and `verbatimModuleSyntax` on top of `strict`. No `any` in checked-in code, no `@ts-expect-error`
without a comment explaining the reason.

**NFR-2 — Layer boundaries are enforced by tooling, not convention.** An illegal import must fail a
command that runs in CI, not a code review.

**NFR-3 — Every I/O dependency of a use case is a port.** Use cases must be executable in unit tests
with no database, no broker and no filesystem.

**NFR-4 — Determinism is injectable.** Time and identifier generation enter the system through
ports, so a test can pin both.

**NFR-5 — Exact decimal arithmetic.** Money and quantities are represented by a decimal value object
backed by an arbitrary-precision library configured with sufficient precision, and stored in
PostgreSQL as `NUMERIC`. Values exceeding the storable scale are rejected, never silently rounded.

**NFR-6 — At-least-once tolerance.** The system assumes duplicate delivery as the normal case.
Correctness must not depend on the broker delivering exactly once, because no broker does.

**NFR-7 — Structured, correlated logs.** Every log line carries a correlation identifier that
follows a request from HTTP intake through the message into the worker.

**NFR-8 — Fast feedback.** The unit test suite runs with no infrastructure. Tests that need Postgres
or RabbitMQ are a separate, explicitly invoked suite.

**NFR-9 — Graceful shutdown.** On `SIGTERM`, the worker stops accepting deliveries, finishes
in-flight work, and closes its connections before exiting.

## 3. Non-goals

These are out of scope by decision, not by oversight. Section 7 of [ARCHITECTURE.md](ARCHITECTURE.md)
lists what I would add next and in what order.

- **NG-1** — No tax logic: no cost basis, no lot matching, no gain/loss calculation, no jurisdiction
  rules.
- **NG-2** — No real integrations: no exchange APIs, no blockchain RPC, no price or FX feeds.
- **NG-3** — No authentication or authorization. The user identity is supplied by a header and
  trusted.
- **NG-4** — No transfer matching between a user's own wallets.
- **NG-5** — No metrics or distributed tracing; structured logs with correlation identifiers only.
- **NG-6** — No horizontal-scale concerns beyond what the design must not preclude: no partitioning,
  no read replicas, no sharding.
- **NG-7** — No admin surface for dead-letter replay; the queue is inspected through the RabbitMQ
  management UI.

## 4. Assumptions

Where the brief was open, I chose and recorded the reasoning. Contested choices have a full ADR in
[docs/adr](docs/adr); the rest are stated here.

**A1 — Node 22 with pnpm rather than Bun.** Koinly runs Bun but the brief says to pick what I can
best defend. Every line of source here is runtime-agnostic TypeScript; moving to Bun is a Dockerfile
and a test-runner change, not an architectural one. I kept RabbitMQ, PostgreSQL and Vitest from
their stack so the discussion stays on architecture rather than tooling novelty.
See [ADR-0001](docs/adr/0001-runtime-and-toolchain.md).

**A2 — A modular monolith with two runtime roles, not microservices.** One image, started as either
`api` or `worker`. At this stage, service boundaries would be guesses; module boundaries are cheap to
move and deployment boundaries are not. The ports and the versioned message envelope are exactly the
cut lines if we later split. See [ADR-0002](docs/adr/0002-modular-monolith.md).

**A3 — The message carries a pointer, not the payload.** An exchange export can be tens of megabytes;
brokers are not blob stores. The import row plus a payload reference is the source of truth.
See [ADR-0010](docs/adr/0010-claim-check-messages.md).

**A4 — Delivery is at-least-once.** Correctness comes from idempotent writes and a unique natural
key, not from broker guarantees. See [ADR-0007](docs/adr/0007-layered-idempotency.md).

**A5 — A transaction has multiple legs.** A trade is an outgoing leg, an incoming leg and usually a
fee leg. Modelling it as one signed amount with one currency is the most expensive mistake to unwind
later in a tax product, so the slice includes `transaction_entries` from the start.
See [ADR-0005](docs/adr/0005-multi-leg-transactions.md).

**A6 — Assets are entities, not strings, and they are not invented at runtime.** `USDC` exists on
many chains and symbols are squattable, so an asset has an identity. Unknown symbols fail the row
rather than auto-creating an asset: a tax system quietly minting assets is worse than one that
refuses the row and tells you.

**A7 — Ownership exists from day one.** A minimal `users` table so `wallets` has a real foreign key
and uniqueness is scoped per tenant. Retrofitting tenancy into keys and unique constraints after the
fact is painful; three columns now is cheap.

**A8 — Amounts are `NUMERIC(38,18)` in PostgreSQL and a `Decimal` value object in TypeScript.**
Never `number`, never `float8`. PostgreSQL silently *rounds* values that exceed the declared scale,
so the domain rejects them before they reach the driver.
See [ADR-0004](docs/adr/0004-money-representation.md).

**A9 — Intake persists and then publishes, which leaves a small crash window.** A transactional
outbox is the correct fix and is not implemented in this timebox. The window is documented, and two
mitigations exist: retrying the intake request with the same idempotency key republishes an import
that is still `pending`, and the same holds for an explicit replay.
See [ADR-0011](docs/adr/0011-persist-then-publish.md).

**A10 — No Redis.** Nothing in this slice needs a cache or a distributed lock; PostgreSQL advisory
locks cover the one mutual-exclusion requirement. Adding Redis because it appears on the stack list
is exactly the over-engineering the brief warns about. What would make me add it: rate-limit budgets
shared across workers when real exchange APIs arrive.

**A11 — Two source adapters, not one.** One adapter never proves that an adapter seam is real, so
there is a CSV exchange export and a JSON pseudo-chain payload with genuinely different shapes.

**A12 — Sources without stable row identifiers get a content-derived key that includes an occurrence
ordinal.** Hashing content alone would collapse two genuinely identical trades in the same second
into one row, which is data loss dressed up as idempotency. See FR-7 and
[ADR-0007](docs/adr/0007-layered-idempotency.md).

## 5. Glossary

- **User** — the tenant that owns wallets. Identity management is out of scope; a user is an opaque
  identifier here.
- **Wallet** — an account at a source: an exchange account, or an on-chain address. The unit that
  transactions belong to and that balances are computed over.
- **Source** — a system that transactions come from, such as an exchange or a chain. Each source has
  an adapter that knows how to read and interpret its payloads.
- **Import** — one attempt to ingest one payload into one wallet. Has a lifecycle, a row count and
  an outcome.
- **Transaction** — one economically meaningful event in a wallet: a deposit, a withdrawal, a trade.
  Composed of one or more entries.
- **Entry (leg)** — one asset movement within a transaction: a direction (`in`, `out`, `fee`), an
  asset and a strictly positive quantity.
- **Asset** — a currency or token, identified by symbol and, where applicable, chain and contract
  address.
- **Normalization** — the pure transformation from source-shaped records into domain transactions.
- **External id** — the natural key that makes a transaction identifiable across re-imports. Either
  the source's own identifier or a deterministic hash of the row's content plus an occurrence
  ordinal.

## 6. Traceability

Each functional requirement and the test that proves it.

Three files carry most of it. `repository-contract.ts` is a suite, not a test: it is executed twice,
against the in-memory fakes (`fakes.contract.test.ts`) and against PostgreSQL
(`postgres.contract.integration.test.ts`), so a requirement traced to it is proven of both.

| Path | Short name below |
| --- | --- |
| `packages/application/src/testing/repository-contract.ts` | the repository contract |
| `tests/e2e/src/import-pipeline.integration.test.ts` | the end-to-end test |

- **FR-1** — the repository contract, "returns the existing wallet when the same identity is
  registered again".
- **FR-2** — `packages/application/src/use-cases/request-import.use-case.test.ts` (same key returns
  the same import; the same key with a different body raises a conflict), and the repository
  contract, "is idempotent on the tenant-scoped idempotency key".
- **FR-3** — same use-case test: intake publishes a job and never touches the transaction
  repository.
- **FR-4** — `packages/application/src/use-cases/process-import.use-case.test.ts` and the end-to-end
  test, which reads the imported rows back through the HTTP API.
- **FR-5** — `packages/domain/src/normalization/normalize.test.ts` (normalizing the same drafts
  twice yields deeply equal output, including identical external ids).
- **FR-6** — `process-import.use-case.test.ts` (processing twice yields one set of rows) and two
  assertions in the end-to-end test: republishing the message changes nothing, and a second import
  of the same payload reports `imported: 0, skipped: 8`.
- **FR-7** — `packages/domain/src/normalization/external-id.test.ts` (two identical rows produce two
  distinct keys, stable across runs) and `packages/infrastructure/src/sources/adapters.test.ts`.
- **FR-8** — `packages/infrastructure/src/db/numeric-round-trip.integration.test.ts`, the repository
  contract's "round-trips a quantity without losing a digit", and
  `packages/domain/src/money/decimal.test.ts` for the boundary rules.
- **FR-9** — `packages/domain/src/transaction/transaction.test.ts` (a trade builds three legs; a
  zero or negative quantity is rejected).
- **FR-10** — the repository contract, "pages through every row exactly once, newest first", plus
  the paginated read in the end-to-end test.
- **FR-11** — the end-to-end test, which polls the import through the API until it reaches a
  terminal state, and the repository contract's lifecycle case.
- **FR-12** — `process-import.use-case.test.ts` (a permanent failure marks the import failed; a
  transient one leaves it processing and rethrows) and
  `packages/infrastructure/src/messaging/retry-policy.test.ts` for the routing decision.
- **FR-13** — `process-import.use-case.test.ts` covers takeover through the lock port; the
  PostgreSQL advisory lock itself is covered by the repository contract's "lets only one holder into
  the lock at a time".
- **FR-14** — the compose healthchecks (the API's gate on `/readyz`) and the readiness check wired
  into the end-to-end test's server.
- **FR-15** — proven by `docker compose up` and `scripts/demo.sh`; not automated in CI.

Not a requirement, but the gap that made it necessary: `pnpm smoke` loads every compiled entrypoint
under plain Node, because Vitest transpiles with esbuild and the image runs `tsc` output.
