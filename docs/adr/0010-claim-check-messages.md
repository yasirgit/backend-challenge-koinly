# ADR-0010 — Messages carry a reference, not the payload

**Status:** accepted

## Context

An import is triggered by a payload: a CSV export, a page of exchange API results, a batch of chain
transfers. The naive design puts that payload in the message body so the worker has everything it
needs. Real exchange exports run to tens of megabytes and hundreds of thousands of rows.

## Decision

The message body is small and fixed:

```jsonc
{
  "messageId": "…",          // uuidv7
  "type": "import.requested",
  "schemaVersion": 1,
  "occurredAt": "…",
  "correlationId": "…",
  "payload": {
    "importId": "…",
    "walletId": "…",
    "sourceType": "acme_exchange_csv",
    "payloadRef": "fixtures/acme-exchange/trades.csv"
  }
}
```

The `imports` row is the source of truth; `payloadRef` locates the bytes. The worker resolves the
reference through the `SourceAdapter` for that source type and streams the content.

The envelope carries `schemaVersion` so a consumer can reject or branch on a shape it does not
understand. There is no schema registry; the version field is the hook if one is ever needed.
`causationId` was considered and dropped — with a single message type it is ceremony.

## Consequences

- Message size is bounded and predictable, so broker memory and disk stay predictable regardless of
  import size.
- Redelivery is cheap: re-reading the reference costs nothing on the broker.
- The payload store becomes part of the system's durability story. In this skeleton it is a
  container-local fixtures directory, which is *not* durable or shared across hosts. In production
  it is object storage with a content-addressed key, and the reference should carry a content hash
  so a worker can detect that the bytes changed under it.
- There is a lifecycle question the skeleton does not answer: who deletes payloads, and when, given
  that an import may be replayed months later during an audit.
- The worker needs read access to the payload store, which is an extra dependency to fail on. It
  fails as a transient error and retries.

## Alternatives considered

**Payload inline in the message.** Self-contained, no external dependency, trivially replayable.
Rejected on size: RabbitMQ tolerates large messages badly, memory pressure turns into broker-wide
flow control, and the broker becomes an unindexed data store. It would work only if imports were
guaranteed small, which is not a guarantee this domain can make.

**Rows inline, one message per row.** Bounded message size and natural parallelism. Rejected because
it moves the fan-out to intake — which then has to parse the payload synchronously, the exact work
the queue exists to defer — and because per-row messages multiply broker traffic by five orders of
magnitude for no gain when the work is a bulk insert anyway. Worth revisiting if per-row processing
ever becomes expensive enough to parallelize.

**Payload staged in a database table read by the worker.** Removes the external store and gets
transactional staging for free, which would also close the window in
[ADR-0011](0011-persist-then-publish.md). Rejected because large binary payloads in the primary
database is a pattern that ages badly, but it is a reasonable interim step before object storage.
