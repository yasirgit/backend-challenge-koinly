# ADR-0004 — `NUMERIC(38,18)` plus a `Decimal` value object; never `number`

**Status:** accepted

## Context

This is a tax product: a wrong balance is a wrong tax return. Crypto quantities span eighteen
decimal places (wei) and twenty-plus integer digits (meme-coin supplies), which is well outside what
an IEEE-754 double represents exactly. The failure mode is not a crash; it is a number that is
subtly wrong and passes every test that uses round figures.

There are three places precision can leak: the database column, the driver, and the language. All
three have to be closed, and closing two of them is worth nothing.

## Decision

**In PostgreSQL:** `NUMERIC(38,18)` for every quantity. Eighteen fractional digits covers
18-decimal chains exactly; twenty integer digits covers any realistic supply. Quantities are
`CHECK (quantity > 0)` and direction is carried by the entry (see
[ADR-0005](0005-multi-leg-transactions.md)).

**In the driver:** `node-postgres` returns `NUMERIC` as a string by default. That default is
load-bearing, so it is asserted explicitly at pool construction and covered by an integration test
that round-trips `0.000000000000000001` and a twenty-digit integer part and compares strings.

**In TypeScript:** a `Decimal` value object wrapping `decimal.js`, configured with precision well
above the storable range because the library's default of twenty significant digits silently
truncates. `Decimal` is constructed from strings only, serializes through `toJSON` as a plain
decimal string (never exponential notation, never a JSON number), and has no implicit conversion to
`number`. An `AssetAmount` pairs a `Decimal` with an asset reference so a bare quantity cannot
travel through the system without its unit.

**On the boundary:** PostgreSQL *rounds* rather than errors when an inserted value exceeds the
declared scale, which would make the column that exists to prevent precision loss the thing that
causes it. So `Decimal` rejects values whose scale exceeds 18 or whose precision exceeds 38 at
construction time, before the driver ever sees them. Out-of-range input fails the row loudly.

Enforcement: dependency-cruiser forbids `parseFloat` and `Number(` in the money modules, and the API
response types declare amounts as `string`.

## Consequences

- Arithmetic is verbose: no `+`, only `Decimal` methods. That is the intended friction.
- Sums happen in PostgreSQL where possible, which is exact for `NUMERIC` and avoids pulling rows
  into the application to add them up.
- Assets with more than eighteen decimals are rejected rather than rounded. That is the correct
  default for tax data — it surfaces as a failed row with a clear message instead of a silently
  wrong balance — but it is a real limitation and it is recorded in `assets.decimals`.
- Every layer needs discipline. The lint rules and the round-trip test are what make the discipline
  survive contact with a deadline.

## Alternatives considered

**Integer base units in a `NUMERIC(78,0)` or `BIGINT` column, plus `decimals` on the asset.** How
EVM does it, and exact by construction. Rejected because every read has to know the asset's decimals
to mean anything, cross-asset queries become unreadable, and a wrong or changed `decimals` value
silently rescales history. It also does not survive assets whose precision is not a power of ten.

**Strings in `TEXT` with all arithmetic in the application.** Maximum flexibility, no rounding
surprises on write. Rejected because it throws away every database-level guarantee: no ordering, no
`SUM`, no range checks, and nothing stops `"abc"` or `"1e5"` from being stored.

**`NUMERIC` with no precision or scale.** PostgreSQL supports arbitrary precision, and this never
rounds. Genuinely tempting, and it is what I would switch to if 18 decimals turned out to be too
tight. Rejected here because the declared scale is also a sanity constraint that catches unit
errors at the boundary, and unconstrained `NUMERIC` gives storage and index sizes that vary per row.

**`float8` or JavaScript `number`.** Not viable. Documented only so the rejection is on the record.
