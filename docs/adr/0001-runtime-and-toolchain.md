# ADR-0001 — Node 22 with pnpm and Vitest rather than Bun

**Status:** accepted

## Context

The brief fixes TypeScript in strict mode and leaves the rest of the toolchain open, noting that
Koinly runs on Bun with RabbitMQ, Redis, PostgreSQL and Vitest, and inviting me to pick what I can
best defend. There is a real pull towards matching the target stack exactly, and a real cost if the
toolchain becomes the interesting part of the submission instead of the architecture.

## Decision

Node 22 with pnpm workspaces, `tsx` for local execution, `tsc` for builds and Vitest for tests.
RabbitMQ, PostgreSQL and Vitest are kept from their stack. Redis is not used (see
[ADR-0006](0006-rabbitmq-topology.md)).

The application source stays runtime-agnostic: no `Bun.*`, no `node:`-only APIs beyond `crypto`,
`fs` and `process` at the composition edges. Moving to Bun is a change to the Dockerfile, the
package scripts and the test runner invocation, not to any module in `domain`, `application` or
`infrastructure`.

## Consequences

- pnpm's strict, non-hoisted `node_modules` layout is what makes the workspace dependency graph a
  real constraint: a package cannot import something it did not declare. That is load-bearing for
  [ADR-0003](0003-enforced-boundaries.md) and Bun's installer does not give me the same guarantee.
- I give up the startup and install speed of Bun, which matters little for a service that runs long
  and starts rarely.
- I carry a build step (`tsc`) that Bun would let me skip. In exchange the build is also the
  boundary check, which I would want in CI anyway.
- The team would need to port this to Bun to adopt it. The port is mechanical, and I would take that
  as an explicit first task rather than pretending the choice is free.

## Alternatives considered

**Bun.** Matches the target stack exactly, removes the build step, and would score points for
familiarity. Rejected because the boundary enforcement I wanted leans on pnpm's resolution
semantics, and because I would rather spend a fixed budget on the data model than on discovering
Bun-specific edges in `amqplib` or `pg` under load. This is the alternative I would switch to first
if the team pushed back.

**Deno.** Better standard-library story and built-in permissions, but the smallest ecosystem overlap
with the target stack and no organizational reason to introduce it.
