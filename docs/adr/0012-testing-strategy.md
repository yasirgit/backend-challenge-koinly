# ADR-0012 — Ports and fakes, shared contract tests, compose-provided infrastructure

**Status:** accepted

## Context

Two failure modes to avoid. One is a suite that needs Docker for every assertion, so it is slow,
nobody runs it locally, and it only fails in CI. The other is a suite built on mocks, which is fast
and green and proves nothing, because the mocks encode the author's belief about the database rather
than the database's behaviour.

The brief asks for "a test or two showing how testing is meant to work here", so the shape of the
suite matters more than its coverage.

## Decision

Four tiers, with a clear rule for what belongs where.

**1. Domain unit tests.** Pure functions and value objects: decimal arithmetic and scale rejection,
transaction invariants, external-id derivation. No I/O, no fakes, milliseconds. Includes the
determinism test — normalizing the same fixture twice must produce deeply equal output — which is
only meaningful because time and ids are injected ([ADR-0009](0009-uuidv7-identifiers.md)).

**2. Use-case tests.** Real use cases against in-memory fakes for every port, with a fixed clock and
a sequential id generator. These are where idempotency and error classification are proven, because
those behaviours live in orchestration. If a use case cannot be tested this way, a dependency has
escaped its port — the suite is also a boundary check.

**3. Repository contract tests.** One suite, executed twice: once against the in-memory fake and
once against PostgreSQL. This is the mechanism that stops the fakes from drifting into fiction — a
fake that passes the same contract as the real adapter is a legitimate substitute in tier 2. The
`NUMERIC` round-trip test lives here, because it is a claim about the driver, not about the code.

**4. End-to-end.** One test over the real pipeline: request an import over HTTP, let a real worker
consume from a real broker, poll until the import is terminal, read the transactions back, then
republish the same message and assert that nothing duplicated. It is slower than the rest of the
suite combined and it is worth it, because the seam it covers — publish, deliver, consume — is the
one the whole exercise is about, and it is the one seam that in-process fakes cannot exercise.

**Infrastructure comes from compose**, not Testcontainers: `docker compose -f docker-compose.test.yml`
brings up PostgreSQL and RabbitMQ on separate ports with a separate database name. Docker is already
a hard requirement of the project, so this adds no dependency and no new concept.

`pnpm test` runs tiers 1 and 2 with no infrastructure. `pnpm test:integration` runs tiers 3 and 4.
CI runs both.

## Consequences

- The fast path stays fast, so the tests that run on every save are the ones that catch logic errors.
- Fakes are trustworthy because a contract test says so, which is what makes tier 2 meaningful
  rather than decorative.
- Integration tests share a database, so they must not assume an empty schema. Each test scopes its
  data to a freshly created user and wallet rather than truncating tables.
- Contract tests cost extra design work: the fake has to be good enough to pass real assertions.
  That cost is the point.
- No Testcontainers means slightly weaker isolation under parallel CI runs and manual lifecycle
  management in scripts.

## Alternatives considered

**Testcontainers for everything.** Per-suite isolation, parallel-safe, no shared state. The better
answer for a large CI matrix. Rejected here to avoid a second way of starting the same containers
when compose already has to exist.

**Mocking the database client.** Fast, and it tests nothing about SQL, constraints or conflict
handling — precisely the parts of this design that carry the correctness argument.

**Only end-to-end tests.** Highest confidence per test, worst feedback loop and worst failure
diagnostics. A broken decimal comparison should fail in a test named after decimals, not in a
five-second pipeline test.
