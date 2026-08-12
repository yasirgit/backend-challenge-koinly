# ADR-0003 — Boundaries enforced by workspaces, project references and dependency-cruiser

**Status:** accepted

## Context

The brief asks directly whether the boundaries are real or just folder names. A layered folder
structure with no enforcement decays predictably: someone under deadline pressure imports a
repository into a route handler, the review waves it through, and six months later the layering is
fiction. Whatever mechanism I choose has to fail a command, not a conversation.

## Decision

Four layers of enforcement, from strongest to most flexible.

1. **pnpm workspace packages.** Five packages whose `package.json` dependencies *are* the permitted
   dependency graph. `@app/domain` does not depend on `@app/infrastructure`, so under pnpm's
   non-hoisted layout the import does not resolve. This is the answer to "are the boundaries real".
2. **TypeScript project references.** Each package is `composite`, with `references` mirroring the
   dependency graph. Illegal imports fail `tsc` with a clear message, and builds get incremental as
   a side effect.
3. **`exports` maps.** Each package exposes only its public entrypoint, so nobody can reach into
   another package's internals even when the package dependency is legitimate.
4. **dependency-cruiser.** For rules the type system cannot express:
   - no circular dependencies anywhere;
   - `process.env` only inside `infrastructure/src/config`;
   - wall-clock and randomness only inside the clock and id adapters;
   - **route handlers and message handlers may not import `infrastructure`** — only the composition
     roots (`api/src/container.ts`, `worker/src/container.ts`) may;
   - **`infrastructure` may import `application/ports` but never `application/use-cases`** — wiring
     is the composition root's job, not an adapter's.

The last two rules protect the boundary most likely to be violated in practice, which package
boundaries alone do not catch: `api` legitimately depends on `infrastructure`, so only a finer-
grained rule can stop a route from bypassing its use case.

CI runs `typecheck`, `lint`, `depcruise` and the unit suite on every push. A boundary that is not in
CI is decoration.

## Consequences

- The dependency direction is discoverable without a tour: read five `package.json` files.
- Build wiring is real work — per-package `tsconfig.json`, references, `exports`, and a Docker build
  that has to understand the workspace. This is the main cost and it is front-loaded.
- Adding a package is deliberate, which is the point, but it also means the structure resists
  cheap experiments.
- Violations are caught at author time in the editor, not at review time.

## Alternatives considered

**A single package with dependency-cruiser only.** Materially cheaper: no build wiring, a trivial
Dockerfile, and the same rules running in the same CI job. This was a close call and I would accept
it in a code review. I chose workspaces because a lint rule can be suppressed with an inline comment
while an unresolvable import cannot, and because the brief grades this specific question. If the
build wiring had threatened the `docker compose up` requirement, I would have collapsed to this.

**ESLint `no-restricted-imports` with path patterns.** Works, but the rules live far from the
structure they describe and are easy to weaken one exception at a time.

**Nx or Turborepo.** Would give caching and generators on top of the same package graph. Rejected as
tooling weight with no payoff at this size.
