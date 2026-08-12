# ADR-0007 — Idempotency at intake, message and row level

**Status:** accepted

## Context

Delivery is at-least-once. Clients retry, brokers redeliver, workers crash mid-batch and processes
get restarted during deploys. Exactly-once delivery does not exist; exactly-once *effect* does, and
it is built from idempotent writes and natural keys rather than from broker configuration.

There are three independent places a duplicate can enter, so there are three defences. Each is cheap
on its own; the value is that they do not depend on each other.

## Decision

### 1. Intake — idempotency key

`POST /v1/imports` accepts an `Idempotency-Key` header, stored with a `UNIQUE (user_id, idempotency_key)`
constraint on `imports`. The key is scoped to the user rather than global, so one tenant cannot
collide with — or probe for — another's keys.

A repeat with the same key returns the existing import. A repeat with the same key and a *different*
request body returns `409`: the request fingerprint (a hash of the canonicalized body) is stored
alongside the key and compared. Returning the original import for a different request would be a
silent wrong answer, which is worse than an error.

If the existing import is still `pending`, the retry republishes its job before returning. This is
what makes a client retry the recovery path for a failed publish (see
[ADR-0011](0011-persist-then-publish.md)).

### 2. Message — natural idempotency, not a dedupe table

The worker assumes duplicates. Rather than keeping a `processed_messages` table, every operation the
handler performs is idempotent by construction, so a duplicate delivery converges to the same state.
A dedupe table is the fallback if a future write path cannot be made idempotent; it is not needed
yet, and it would be a second source of truth to keep consistent.

Concurrent delivery of the same import to two workers is excluded by
`pg_try_advisory_xact_lock(import_id)`. It is held for the duration of the transaction, it is
released automatically when a crashed worker's connection dies, and a worker that cannot take it
requeues rather than racing. The `imports.status` column is therefore an observability signal, not a
lock — a lease on a status column cannot be correct here, because RabbitMQ redelivers the moment a
channel drops, long before any sane lease would expire.

### 3. Row — deterministic natural key plus a unique constraint

`UNIQUE (wallet_id, external_id)` on `transactions`, written with
`INSERT ... ON CONFLICT DO NOTHING RETURNING id`. Entries are inserted only for parents that
returned a row, inside the same transaction. Reprocessing an import is therefore a no-op.

`external_id` comes from one of two places, recorded in `external_id_kind`:

- **`source`** — the source's own identifier, whenever it provides a stable one. Always preferred.
- **`derived`** — a SHA-256 over the canonical serialization of the normalized transaction: source
  type, wallet, occurrence timestamp, kind, and every leg in order.

The derived key includes an **occurrence ordinal**. Hashing content alone collapses two genuinely
identical trades in the same second — which trading bots produce constantly — into a single row.
That is data loss wearing idempotency's clothes. So identical rows within a payload are counted and
the nth occurrence is folded into the hash: re-importing the same file produces the same ordinals
and stays idempotent, while two real duplicates get distinct keys and both survive.

## Consequences

- Retry, redelivery and manual replay are all safe by the same mechanism, so there is one thing to
  reason about instead of three.
- Row counts reported on an import are per-attempt diagnostics, not idempotent values: a replay
  reports zero newly inserted rows. This is documented on the field rather than papered over.
- `ON CONFLICT DO NOTHING` means a *restated* row — an exchange correcting a fee — is silently
  ignored. The design records a content hash so the conflict can be detected and counted, but acting
  on restatements (supersede chains, versioned transactions) is deliberately out of scope.
- Derived keys are fragile against source format changes: if a source starts emitting an extra field
  that we include in the hash, every row looks new. Mitigations are preferring source ids, keeping
  the hash input to normalized domain values rather than raw source fields, and versioning the hash
  algorithm when it must change.
- Every future write path in the worker inherits the obligation to be idempotent. That constraint is
  a feature in this domain.

## Alternatives considered

**A `processed_messages` table keyed by `messageId`.** Explicit, easy to reason about, and it works
for non-idempotent operations. Rejected because it only dedupes *message* delivery, not the client
retry or the manual replay, so the row-level key would still be needed — and then the table is pure
overhead with its own cleanup problem.

**Transaction primary key derived from the content hash.** Removes the separate `external_id`
column. Rejected because it welds the natural key to the surrogate key, so a hash-algorithm change
becomes a full-table migration touching every foreign key.

**Trusting the source's row order and using `(import_id, row_index)`.** Stable within one file, but
a re-export with rows prepended shifts every index, turning a re-import into a full duplicate set.
