import { type Kysely, sql } from 'kysely';

/**
 * The initial slice: users, assets, wallets, imports, transactions and their entries.
 *
 * Written as literal SQL rather than through the query builder. A financial schema is reviewed
 * more often than it is written, and `create table` in a diff is unambiguous in a way that a
 * builder chain is not.
 *
 * Conventions:
 *  - `timestamptz` everywhere; the database stores instants, never local time.
 *  - `text` with a `CHECK` rather than a native enum: adding a value later is a constraint swap
 *    instead of an `ALTER TYPE`, which cannot run inside a transaction in older PostgreSQL and
 *    cannot remove values at all.
 *  - identifiers are supplied by the application (ADR-0009), so there is no `DEFAULT` on any `id`.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table users (
      id          uuid        primary key,
      external_ref text       not null unique,
      created_at  timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table assets (
      id               uuid        primary key,
      symbol           text        not null,
      -- Empty string rather than NULL for the two optional discriminators. A unique constraint
      -- over nullable columns does not constrain anything in PostgreSQL, and building it over
      -- coalesce() makes ON CONFLICT inference awkward; the sentinel keeps the constraint plain.
      chain            text        not null default '',
      contract_address text        not null default '',
      -- Bounded by what a NUMERIC(38,18) column can hold exactly (ADR-0004). An asset that needs
      -- more precision than this must fail at registration, not silently at the first import.
      decimals         int         not null check (decimals between 0 and 18),
      is_verified      boolean     not null default true,
      created_at       timestamptz not null default now(),
      constraint assets_identity_key unique (symbol, chain, contract_address)
    )
  `.execute(db);

  await sql`
    create table wallets (
      id                 uuid        primary key,
      user_id            uuid        not null references users (id) on delete cascade,
      source_type        text        not null,
      source_account_ref text        not null,
      label              text        not null,
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now(),
      constraint wallets_identity_key unique (user_id, source_type, source_account_ref)
    )
  `.execute(db);

  await sql`
    create table imports (
      id                  uuid        primary key,
      -- Denormalized from the wallet so the idempotency key can be scoped per tenant: a unique
      -- constraint cannot span a join, and a globally unique key lets one tenant collide with
      -- another's (see ADR-0007).
      user_id             uuid        not null references users (id) on delete cascade,
      wallet_id           uuid        not null references wallets (id) on delete cascade,
      source_type         text        not null,
      payload_ref         text        not null,
      idempotency_key     text        not null,
      request_fingerprint text        not null,
      status              text        not null
        check (status in ('pending', 'processing', 'completed', 'failed')),
      attempts            int         not null default 0,
      rows_total          int,
      rows_imported       int,
      rows_skipped        int,
      error               jsonb,
      created_at          timestamptz not null default now(),
      started_at          timestamptz,
      finished_at         timestamptz,
      constraint imports_idempotency_key unique (user_id, idempotency_key)
    )
  `.execute(db);

  // Finding work to recover: stale 'pending' rows whose publish may have been lost, and 'processing'
  // rows abandoned by a crashed worker.
  await sql`
    create index imports_recovery_idx on imports (status, created_at)
      where status in ('pending', 'processing')
  `.execute(db);

  await sql`
    create table transactions (
      id               uuid        primary key,
      wallet_id        uuid        not null references wallets (id) on delete cascade,
      -- Kept for provenance. Nulled rather than cascaded if an import row is ever removed: the
      -- transaction is the record of an event that really happened, the import is just how we
      -- heard about it.
      import_id        uuid        references imports (id) on delete set null,
      external_id      text        not null,
      external_id_kind text        not null check (external_id_kind in ('source', 'derived')),
      kind             text        not null
        check (kind in ('deposit', 'withdrawal', 'trade', 'fee', 'transfer')),
      occurred_at      timestamptz not null,
      source_type      text        not null,
      created_at       timestamptz not null default now(),
      -- The idempotency keystone: re-importing the same payload conflicts here and does nothing.
      constraint transactions_natural_key unique (wallet_id, external_id)
    )
  `.execute(db);

  // Keyset pagination. external_id breaks ties rather than id, because it is derived from content
  // and therefore gives the same order after a re-import; a generated id would not.
  await sql`
    create index transactions_wallet_timeline_idx
      on transactions (wallet_id, occurred_at desc, external_id desc)
  `.execute(db);

  await sql`
    create table transaction_entries (
      transaction_id uuid           not null references transactions (id) on delete cascade,
      entry_index    int            not null,
      -- Denormalized so balances are a single index scan instead of a join back through
      -- transactions (ADR-0005). Written once, with the parent, and never updated.
      wallet_id      uuid           not null references wallets (id) on delete cascade,
      direction      text           not null check (direction in ('in', 'out', 'fee')),
      asset_id       uuid           not null references assets (id),
      -- Exact decimal, never float. Always positive: the sign lives in the direction column, so a
      -- fee is a fee rather than a negative amount somebody forgets to subtract.
      quantity       numeric(38,18) not null check (quantity > 0),
      created_at     timestamptz    not null default now(),
      -- No surrogate key: an entry is part of its transaction and is never addressed on its own,
      -- so its position within the aggregate is its identity.
      constraint transaction_entries_pkey primary key (transaction_id, entry_index)
    )
  `.execute(db);

  await sql`
    create index transaction_entries_balance_idx on transaction_entries (wallet_id, asset_id)
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table if exists transaction_entries`.execute(db);
  await sql`drop table if exists transactions`.execute(db);
  await sql`drop table if exists imports`.execute(db);
  await sql`drop table if exists wallets`.execute(db);
  await sql`drop table if exists assets`.execute(db);
  await sql`drop table if exists users`.execute(db);
};
