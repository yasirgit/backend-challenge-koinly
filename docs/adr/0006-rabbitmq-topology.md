# ADR-0006 — RabbitMQ with manual ack, delayed retry and a dead-letter parking lot

**Status:** accepted

## Context

Intake has to hand work to a worker durably. The candidates are a real broker (RabbitMQ, which
Koinly runs), a database-backed queue (pg-boss), or Redis-backed job queues (BullMQ). The choice
determines the entire failure story, so it is worth being explicit about what each one buys.

## Decision

RabbitMQ, with this topology:

```
koinly.imports (topic, durable)
  └─ import.requested ──> imports.normalize        (durable, manual ack, prefetch N)
                              │ nack(requeue=false) on retryable failure
                              ▼
                          imports.normalize.retry  (x-message-ttl, DLX back to koinly.imports)
                              │ TTL expiry re-routes to import.requested
                              └─────────────────> back to imports.normalize
  attempts exhausted / permanent failure ────────> imports.dlq (parking lot, no consumer)
```

- Messages are published `persistent` with publisher confirms; the publish is not considered done
  until the broker confirms it.
- The consumer uses manual acknowledgement with a configured prefetch, so an unacknowledged message
  is redelivered if the channel drops.
- The attempt counter travels in an explicit `attempt` message header, incremented on each republish.
  It is not derived from `x-death`, which is easy to misread across multi-hop dead-lettering.
- A message whose envelope fails schema validation is a poison message: it goes straight to
  `imports.dlq` without retrying, because redelivering it will never produce a different result.
- Permanent failures (unknown source, unknown asset, malformed payload) also bypass retry. Unknown
  errors are treated as transient until attempts are exhausted, which is the safe default: a
  database blip should not permanently fail a batch of imports.

## Consequences

- Backpressure is real and adjustable: prefetch bounds in-flight work per worker, and the queue
  absorbs bursts.
- The dead-letter queue is an operational surface. Someone has to look at it, and there is no admin
  UI for replay in this iteration — it is inspected through the RabbitMQ management console.
- The retry queue is a single TTL tier. Messages leave a TTL queue in publication order, so a long
  TTL would head-of-line block shorter ones; tiered backoff needs one queue per tier. I chose one
  tier plus a max attempt count because it is honest about what it does, and noted the tiered
  version as the extension.
- The broker cannot participate in a database transaction, which is the source of the crash window
  in [ADR-0011](0011-persist-then-publish.md). This is the real cost of the choice.
- An extra container in compose, and reconnection handling in the adapter.

**Redis is deliberately absent.** Nothing here needs a cache, and the one mutual-exclusion
requirement is served by a PostgreSQL advisory lock, which is free and dies with the connection.
Adding Redis because it appears on the stack list would be exactly the over-building the brief warns
against.

## Alternatives considered

**pg-boss (PostgreSQL-backed queue).** Strongest argument against my choice: enqueue becomes part of
the same transaction as the import row, which deletes the persist-then-publish window entirely, and
it removes a container. Rejected because the brief specifically wants to see the queueing seam and
because coupling ingestion throughput to the primary database is a decision that gets expensive at
volume — but if the priority were purely correctness-per-hour, this would win.

**BullMQ on Redis.** Best developer ergonomics and good retry primitives out of the box. Rejected
because Redis persistence is the weakest of the three for financial work, and because it would mean
introducing Redis for one purpose.

**Kafka.** Right answer for a replayable event log, which is plausibly where the reconciliation side
of this product ends up. Rejected as far too much operational weight for a work queue.
