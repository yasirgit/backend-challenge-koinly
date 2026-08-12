# ADR-0002 — Modular monolith with two runtime roles

**Status:** accepted

## Context

The system described in the brief is a distributed data-processing backend: ingest, normalize,
reconcile. It is tempting to model that as separate services from the start, because the eventual
shape probably is several services. The counter-pressure is that nobody knows yet where the seams
belong, and a wrong service boundary is orders of magnitude more expensive to move than a wrong
module boundary.

## Decision

One codebase, one built image, two runtime roles selected by the start command:

- `api` — HTTP intake and reads.
- `worker` — queue consumer.

They share `domain`, `application` and `infrastructure`, and each has its own composition root that
wires concrete adapters into use cases. `migrate` and `seed` are one-shot commands from the same
image.

## Consequences

- Deploying is one artifact with two deployments, so a schema change and the code that depends on it
  ship together. No cross-service version negotiation for a change that is logically atomic.
- The API and the worker scale independently, which is the only scaling axis that matters here: the
  worker is CPU- and database-bound, the API is not.
- The seams that would become service boundaries already exist and are already crossed
  asynchronously: the ports in `application` and the versioned message envelope. Splitting the
  worker out later means changing composition roots and deployment, not rewriting call sites.
- The risk is the usual one: shared code makes it easy to reach across a boundary that would be a
  network hop later. That is what [ADR-0003](0003-enforced-boundaries.md) exists to prevent.
- A single image means the API container carries the worker's dependencies. That is a few megabytes
  and a slightly larger attack surface, which I accept for the simpler build.

## Alternatives considered

**Separate services per stage (intake, normalization, reconciliation).** Matches the eventual
architecture and forces boundaries to be honest. Rejected as premature: it would multiply the
infrastructure work in a fixed timebox, and it locks in seams chosen with the least information we
will ever have.

**A single process that consumes its own queue.** Simplest of all, and defensible for a skeleton.
Rejected because the brief explicitly asks to see the intake-to-worker pipeline shape, and because
collapsing the roles hides the failure modes that make the design interesting.
