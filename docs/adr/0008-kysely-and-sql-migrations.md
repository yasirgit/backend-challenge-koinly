# ADR-0008 — Kysely with hand-written SQL migrations rather than an ORM

**Status:** accepted

## Context

The schema is the graded artifact here, and the queries that matter — batch upsert with conflict
handling, keyset pagination, exact `SUM` over `NUMERIC`, advisory locks — are all things ORMs either
hide or make awkward. At the same time, hand-rolling `pg` calls with string concatenation gives up
type safety over a schema that is the whole point.

## Decision

**Kysely** as a typed query builder over `node-postgres`, with the database schema types declared by
hand in `infrastructure/src/db/schema.ts`.

**Migrations as explicit SQL** inside Kysely migration files, executed with `sql` template literals
rather than the builder API. Each has an `up` and a `down`. They run as a one-shot `migrate` command
that compose executes before the API and worker start.

Repositories map rows to domain aggregates explicitly, with `toDomain` / `toRow` functions. There is
no automatic hydration, no identity map and no lazy loading: a repository returns domain objects or
plain DTOs, never a Kysely row.

## Consequences

- Every statement that touches money is readable SQL in the diff. For a financial schema, review
  quality matters more than authoring speed.
- `ON CONFLICT DO NOTHING RETURNING`, `pg_try_advisory_xact_lock` and keyset predicates are written
  directly, without fighting an abstraction.
- No codegen step in the build, so `docker compose up` has one fewer thing to fail at.
- Hand-written schema types can drift from the migrations. This is the real cost. It is contained at
  this size, the integration tests run against a migrated database so drift surfaces immediately,
  and `kysely-codegen` is the fix when the schema outgrows a single file.
- Mapping code is boilerplate. It is also the only place the database vocabulary meets the domain
  vocabulary, which is worth having explicit.

## Alternatives considered

**Prisma.** Best-in-class DX and migration tooling, and the schema file doubles as documentation.
Rejected because its `Decimal` handling and its distance from raw SQL work against
[ADR-0004](0004-money-representation.md), because the generated client is a build step in the
critical path of the one hard startup requirement, and because expressing the upsert-and-return
pattern means dropping to `$queryRaw` anyway.

**Drizzle.** Very close call: SQL-shaped, good types, migrations that stay readable. I would be
comfortable with it. Chose Kysely because I wanted migrations as literal SQL rather than as a
schema-diffing artifact, and because Kysely's query types are a thinner abstraction over what
actually executes.

**TypeORM / Sequelize.** Active-record and decorator-heavy patterns that pull persistence concerns
into entity classes, which is precisely the coupling the layering exists to prevent.

**Raw `pg` with a migration runner.** No type safety over the schema, and every query becomes a
review of string interpolation. The safety Kysely adds costs nothing at runtime.
