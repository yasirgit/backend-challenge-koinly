# Staff Backend Engineer — Take-Home Assignment

## Context

Imagine a crypto portfolio tracker and tax reporting product. Behind the product sits a
distributed data-processing backend: it ingests raw transaction data from exchanges and
blockchains, normalizes it into a common model, and reconciles it into numbers people
file taxes with. Correctness is not negotiable — a wrong balance is a wrong tax return.

You're laying the technical foundation for a brand-new backend for such a product.
Before any business logic gets written, the architecture needs to be in
place: how the code is organized, where the boundaries are, how work flows through the
system, and what keeps quality high as the team and codebase grow.

That foundation is what we want you to build.

## The Task

Create the **architectural skeleton** of a backend data-processing service for a
crypto-tax product.

We are explicitly **not** interested in business logic. No real tax math, no real
blockchain integrations — stubs and fixtures are fine. What matters is the architecture,
the boundaries, and the data model.

Your skeleton should show:

- **Structure & boundaries** — how the code is organized, which layers exist, and which
  direction imports may flow. A new developer should know where new code belongs.
- **Pipeline shape** — how an import flows through the system: intake → queue →
  worker → persistence. Implementations can be stubs; we're looking at the seams,
  including where idempotency and failure handling would live.
- **Data model** — a PostgreSQL schema for a small slice of the domain (e.g. wallets and
  transactions), with migrations. This is the part where design matters to us: entity
  boundaries, keys, and how you represent monetary values.
- **One thin end-to-end flow** — a fixture import (e.g. a CSV or a fake exchange
  payload) travels through the queue, gets normalized by a worker, lands in PostgreSQL,
  and is readable back via a minimal endpoint or CLI command. Plus a test or two showing
  how testing is meant to work here.

Everything else can be a stub — and stating what you stubbed is part of the task.

## Constraints

- **TypeScript**, strict mode. The rest of the toolchain is your call (we run on Bun
  with RabbitMQ, Redis, PostgreSQL, and Vitest — but pick what you can best defend).
- It must start with a single command ``docker compose up`` bringing up the app and its infrastructure. No other setup
  beyond Docker. A short note on how to trigger and observe the example flow belongs
  in the README.

## The Write-Up

Add a short `ARCHITECTURE.md` (one page is enough) covering:

- The layers/boundaries you chose and why.
- How the pipeline stays correct under failure: what happens on a retry, a duplicate
  message, a crashed worker — even if only designed, not implemented.
- What stops the structure from eroding as the codebase grows.
- What you deliberately skipped and would add next.

## What We Evaluate

1. Clarity of the structure — could a new hire find their way around without a tour?
2. Are the boundaries real (enforced by tooling) or just folder names?
3. Sound choices at the seams: queueing, persistence, external integrations, typing of
   domain data (especially money).
4. Rigor around correctness — does the design take determinism and idempotency
   seriously, without over-building?
5. Pragmatism — over-engineering is as much of a red flag as no structure at all.
6. The reasoning in `ARCHITECTURE.md`.

## Scope & Time

This should take about **4-6 hours**. Cut scope deliberately and say so in the write-up —
that's what we'd expect from a staff engineer, not a shortcut. Using AI tools is fine,
but you own every line: in the follow-up interview we'll walk through the code together
and extend it a bit.

## Submission

1. Create your own copy of this repository using the **"Use this template"** button
   (please do not fork).
2. Push your solution there, including a README covering how to run it.
3. Send us the link when you're done.