import type { ColumnType, Generated } from 'kysely';

/**
 * The database as Kysely sees it. Hand-written rather than generated: at this size the drift risk
 * is contained by the integration tests, which run against a migrated database and fail loudly if
 * this file and the migrations disagree. `kysely-codegen` is the answer when the schema outgrows a
 * single file (see ADR-0008).
 *
 * Column names stay snake_case here and are mapped explicitly in the repositories. The database
 * vocabulary and the domain vocabulary meeting in one visible place is worth the boilerplate.
 */

/** Written by the database default, never by us. */
type CreatedAt = ColumnType<Date, Date | undefined, never>;

/**
 * `NUMERIC` arrives from the driver as a string and leaves as a string, deliberately. The moment
 * this is typed as `number` the exactness argument in ADR-0004 collapses.
 */
type Numeric = ColumnType<string, string, string>;

export interface UsersTable {
  id: string;
  external_ref: string;
  created_at: CreatedAt;
}

export interface AssetsTable {
  id: string;
  symbol: string;
  /** Empty string rather than NULL, so the uniqueness constraint is a plain one (see migration). */
  chain: string;
  contract_address: string;
  decimals: number;
  is_verified: Generated<boolean>;
  created_at: CreatedAt;
}

export interface WalletsTable {
  id: string;
  user_id: string;
  source_type: string;
  source_account_ref: string;
  label: string;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ImportsTable {
  id: string;
  /** Denormalized from the wallet: a unique constraint cannot span a join (see ADR-0007). */
  user_id: string;
  wallet_id: string;
  source_type: string;
  payload_ref: string;
  idempotency_key: string;
  /** Hash of the canonicalized request body, so a reused key with a changed body is a conflict. */
  request_fingerprint: string;
  status: ImportStatus;
  attempts: Generated<number>;
  rows_total: number | null;
  rows_imported: number | null;
  rows_skipped: number | null;
  error: ColumnType<ImportErrorRecord | null, string | null, string | null>;
  created_at: CreatedAt;
  started_at: Date | null;
  finished_at: Date | null;
}

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImportErrorRecord {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TransactionsTable {
  id: string;
  wallet_id: string;
  import_id: string | null;
  external_id: string;
  external_id_kind: 'source' | 'derived';
  kind: string;
  occurred_at: Date;
  source_type: string;
  created_at: CreatedAt;
}

export interface TransactionEntriesTable {
  /** Keyed by `(transaction_id, entry_index)`: an entry has no identity outside its transaction. */
  transaction_id: string;
  entry_index: number;
  /** Denormalized so a balance is one index scan rather than a join (see ADR-0005). */
  wallet_id: string;
  direction: 'in' | 'out' | 'fee';
  asset_id: string;
  quantity: Numeric;
  created_at: CreatedAt;
}

export interface Database {
  users: UsersTable;
  assets: AssetsTable;
  wallets: WalletsTable;
  imports: ImportsTable;
  transactions: TransactionsTable;
  transaction_entries: TransactionEntriesTable;
}
