# ADR-0009 — Application-generated UUIDv7 primary keys

**Status:** accepted

## Context

Identifiers have to be chosen before the first migration, and changing them later touches every
table and every foreign key. The options split on two axes: who generates them (database or
application) and what shape they are (sequential integer or UUID).

Random UUIDv4 primary keys are a known cause of index write amplification: inserts scatter across
the B-tree instead of appending to the right-hand edge. UUIDv7 keeps UUID semantics while restoring
the locality, because the high bits are a millisecond timestamp.

## Decision

UUIDv7, generated in the application, for every primary key.

Generation goes through an `IdGenerator` port. The domain never calls the generator itself — ids and
timestamps are passed in by the use case — so normalization stays a pure function and a test can pin
both. This matters for [ADR-0007](0007-layered-idempotency.md): the determinism test is meaningless
if the code under test can reach the clock or the CSPRNG on its own.

PostgreSQL 17 has no built-in `uuidv7()` (it lands in 18), which would have forced a database
extension or a hand-written function. Generating in the application avoids that and is the better
choice regardless.

## Consequences

- An entity has its identity before it is persisted, so a full aggregate — a transaction and its
  entries — can be constructed and validated in memory and inserted in one round trip, with no
  `RETURNING id` dance and no partial writes to obtain a key.
- Ids are stable across a retry, because the same input produces the same aggregate; only the
  natural key decides whether the row is a duplicate, so the surrogate id being fresh does no harm.
- Tests are deterministic: a sequential fake generator makes fixtures readable and diffs stable.
- Cost: 16 bytes per key, carried by every foreign key and index. `transaction_entries` runs at
  roughly three rows per transaction, so this is the largest single storage decision in the schema.
- UUIDv7 encodes creation time, which leaks a little information in an external identifier. Not
  sensitive here; worth knowing before exposing ids to third parties.
- Ordering by id approximates insertion order, which is useful in logs but must not be mistaken for
  event order. The keyset read therefore orders by `(occurred_at, external_id)`, both of which are
  content-derived and stable, rather than by id.

## Alternatives considered

**`bigserial` surrogate key with a separate external UUID.** The storage-optimal answer: 8-byte
internal keys and joins, with a UUID only on the API surface. This is what I would move to at scale.
Rejected now because it doubles the identity concepts in every table and mapper for a benefit that
is invisible at this size.

**Database-generated `gen_random_uuid()` (v4).** One less thing in the application, but it forfeits
index locality, forces a round trip before the entity has identity, and makes tests non-deterministic
unless mocked at the database.

**Natural keys as primary keys** — `(wallet_id, external_id)` on transactions. Removes a column and
enforces uniqueness by construction. Rejected because natural keys change: a hash-algorithm change
or a source finally exposing stable ids would rewrite every foreign key. The natural key stays a
unique constraint, which is where it belongs.
