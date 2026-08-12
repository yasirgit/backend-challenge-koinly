# ADR-0011 — Persist-then-publish now, transactional outbox deferred

**Status:** accepted, with a known and documented gap

## Context

Intake does two writes to two systems: it inserts an `imports` row in PostgreSQL and publishes a job
to RabbitMQ. There is no distributed transaction across them, so one of them can succeed while the
other fails. Choosing an order chooses a failure mode:

- **Publish first, then persist.** A worker can receive a job for an import row that does not exist
  yet. Every consumer needs to handle a phantom job, and the failure is a hard error on the hot path.
- **Persist first, then publish.** If the publish fails, the import row exists but nothing will ever
  process it. The failure is a stuck record, which is inert and inspectable.

## Decision

**Persist first, then publish**, with the crash window acknowledged rather than hidden.

The window is closed opportunistically rather than atomically:

1. The publish uses **publisher confirms**, so a failure is detected rather than assumed away. If
   the confirm does not arrive, the request returns `502` with the `importId` — the client knows an
   import exists and that it was not queued.
2. **A retry with the same `Idempotency-Key` republishes.** The intake use case, on finding an
   existing import still in `pending`, publishes its job again before returning. Because processing
   is idempotent ([ADR-0007](0007-layered-idempotency.md)), a double publish is harmless, so this is
   safe to do unconditionally.
3. The import's state is visible through `GET /v1/imports/:importId`, so a stuck `pending` row is
   diagnosable rather than invisible.

**A transactional outbox is the correct fix and is not implemented.** The design is: insert the
message into an `outbox` table in the same transaction as the `imports` row, and have a relay poll
unpublished rows, publish them, and mark them sent. Atomic by construction, at the cost of a poller,
a table, publish latency, and its own at-least-once semantics (which the existing idempotency
already absorbs).

## Consequences

- There is a real, if narrow, window: the process can die between commit and confirm, leaving an
  import that no worker will pick up until a client retries with the same key.
- Nothing is ever *lost* — the import row is durable and the payload is untouched. The failure is
  delayed work, not missing work, which is the right failure to have in a system where a wrong
  number is worse than a late one.
- No background poller, no extra table, no publish latency in this iteration.
- The mitigation depends on clients sending idempotency keys and retrying. That is a documented API
  contract, not an assumption about client goodwill, but it is weaker than a server-side guarantee.

## Alternatives considered

**Transactional outbox now.** The principled answer, and the first thing I would add. Deferred to
keep the timebox on the data model and the pipeline, and because the mitigations above cover the
realistic cases. If this design were going to production, this is the blocking item.

**A sweeper that republishes stale `pending` imports.** Roughly thirty lines: a periodic query for
imports that have been `pending` longer than a threshold, republished. Cheaper than an outbox and it
closes the window without client cooperation, at the cost of a fixed detection delay. This is the
pragmatic middle step and the second thing I would add.

**pg-boss, so enqueue is transactional.** Deletes this ADR entirely. See
[ADR-0006](0006-rabbitmq-topology.md) for why the broker was chosen anyway — and this is the
strongest argument against that choice.

**Two-phase commit across PostgreSQL and RabbitMQ.** Technically available, operationally miserable,
and it converts an availability problem into a coordinator problem. Not seriously considered.
