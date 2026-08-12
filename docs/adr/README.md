# Architecture Decision Records

Short records of the decisions that were genuinely contested — the ones where a competent engineer
could reasonably have chosen otherwise, and where I want the reasoning available when someone
revisits the choice. Uncontested decisions live in [ARCHITECTURE.md](../../ARCHITECTURE.md) instead
of getting a record of their own.

Format is a trimmed MADR: context, decision, consequences, alternatives considered, status.

| ADR | Decision |
| --- | --- |
| [0001](0001-runtime-and-toolchain.md) | Node 22 with pnpm and Vitest rather than Bun |
| [0002](0002-modular-monolith.md) | Modular monolith with two runtime roles |
| [0003](0003-enforced-boundaries.md) | Boundaries enforced by workspaces, project references and dependency-cruiser |
| [0004](0004-money-representation.md) | `NUMERIC(38,18)` plus a `Decimal` value object; never `number` |
| [0005](0005-multi-leg-transactions.md) | Transactions own entries rather than a single signed amount |
| [0006](0006-rabbitmq-topology.md) | RabbitMQ with manual ack, delayed retry and a dead-letter parking lot |
| [0007](0007-layered-idempotency.md) | Idempotency at intake, message and row level |
| [0008](0008-kysely-and-sql-migrations.md) | Kysely with hand-written SQL migrations rather than an ORM |
| [0009](0009-uuidv7-identifiers.md) | Application-generated UUIDv7 primary keys |
| [0010](0010-claim-check-messages.md) | Messages carry a reference, not the payload |
| [0011](0011-persist-then-publish.md) | Persist-then-publish now, transactional outbox deferred |
| [0012](0012-testing-strategy.md) | Ports and fakes, shared contract tests, compose-provided infrastructure |
