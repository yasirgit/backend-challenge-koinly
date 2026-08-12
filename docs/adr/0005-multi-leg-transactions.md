# ADR-0005 — Transactions own entries rather than a single signed amount

**Status:** accepted

## Context

The obvious shape for a transactions table is one row per transaction with an `amount` and a
`currency`. It is compact, it reads well, and it is wrong for this domain in a way that is expensive
to discover later.

A trade is not one movement. Selling 0.5 ETH for 1,200 USDC with a 1.20 USDC fee is three asset
movements in one economic event. With a single amount column you either lose the other two legs, or
you invent a second table anyway, or you write three rows and lose the fact that they are one event.
Every one of those choices corrupts the input to cost-basis calculation, which is the entire point
of the product.

## Decision

Two tables:

- `transactions` — the economic event: wallet, kind (`deposit`, `withdrawal`, `trade`, `fee`,
  `transfer`), when it occurred, provenance, and the natural key.
- `transaction_entries` — the movements: `direction` (`in`, `out`, `fee`), `asset_id`, and a
  strictly positive `quantity`, ordered by `entry_index` within the transaction.

Quantities are always positive; sign lives in `direction`. A balance is
`sum(in) - sum(out) - sum(fee)` per asset. Entries cascade on delete from their transaction; the
transaction is the aggregate root and entries are never addressed independently.

`wallet_id` is denormalized onto `transaction_entries` so balance queries are a single index scan on
`(wallet_id, asset_id)` rather than a join back through `transactions`. Denormalization is a
deliberate exception, justified by balances being the most frequent read in a portfolio product; the
column is written once, by the same insert, and is never updated.

## Consequences

- Reads need a join or a second query to assemble a transaction with its legs. The repository does
  this in one query with an aggregate, and the ordering is explicit.
- Invariants become checkable: a trade must have at least one `in` and one `out`; a fee-only
  transaction has exactly one `fee` leg. These live in the domain factory, not in the database.
- Fees are first-class rather than a negative amount somebody forgets to subtract. In a tax product
  fees are deductible, so losing them is a correctness bug, not a rounding detail.
- Adding a leg type — staking rewards, airdrops, rebases — is a new `direction` or `kind` value, not
  a schema migration of the amount column.
- The denormalized `wallet_id` can drift in principle. It cannot in practice because entries are
  immutable and written in the same statement as their parent, and a constraint test asserts the
  invariant.

## Alternatives considered

**Single `amount` + `currency` on `transactions`.** Simplest, and adequate for a deposit-only
system. Rejected for the reasons above: it cannot represent a trade without losing information.

**Full double-entry ledger with accounts and balanced postings.** The accounting-correct model, and
where a mature version of this product probably ends up. Rejected as over-building for a skeleton:
it requires an account hierarchy, a balancing rule per transaction kind, and a story for external
counterparties, none of which the brief asks for. The entries model is deliberately a subset that
can grow into it — adding an `account_id` to entries is the migration.

**Legs as a JSONB column on `transactions`.** Fewer tables, flexible shape. Rejected because it
gives up per-leg constraints, per-asset indexing and exact `SUM`, which are exactly the properties
that make the money story defensible.
