import type {
  AssetId,
  AssetRef,
  ExternalId,
  ImportCounts,
  ImportFailure,
  ImportId,
  ImportRecord,
  SourceType,
  Transaction,
  UserId,
  Wallet,
  WalletId,
} from '@app/domain';

export interface WalletRepository {
  findById: (id: WalletId) => Promise<Wallet | null>;
  findByIdentity: (
    userId: UserId,
    sourceType: SourceType,
    sourceAccountRef: string,
  ) => Promise<Wallet | null>;
  /**
   * Registering the same wallet twice returns the existing one rather than failing, so a retried
   * client request is a no-op (FR-1). `created` tells the caller which happened, because the API
   * answers 201 or 200 accordingly.
   */
  create: (wallet: Wallet) => Promise<{ wallet: Wallet; created: boolean }>;
}

export interface AssetResolver {
  /**
   * Resolves source-supplied references to registry identifiers, keyed by `assetRefKey`.
   *
   * References that are not in the registry are simply absent from the result. Deciding what to do
   * about that is the domain's job, and its answer is to fail the row: silently minting an asset
   * because a payload mentioned an unfamiliar ticker is how scam tokens end up in a tax return.
   */
  resolve: (refs: readonly AssetRef[]) => Promise<ReadonlyMap<string, AssetId>>;
}

export interface ImportRepository {
  /** Idempotent on `(userId, idempotencyKey)`; `created` is false when one already existed. */
  create: (record: ImportRecord) => Promise<{ record: ImportRecord; created: boolean }>;
  findById: (id: ImportId) => Promise<ImportRecord | null>;
  findByIdempotencyKey: (userId: UserId, idempotencyKey: string) => Promise<ImportRecord | null>;

  /** Moves an import to `processing` and increments the attempt counter. */
  beginAttempt: (id: ImportId, startedAt: Date) => Promise<ImportRecord>;
  complete: (id: ImportId, counts: ImportCounts, finishedAt: Date) => Promise<void>;
  fail: (id: ImportId, failure: ImportFailure, finishedAt: Date) => Promise<void>;

  /**
   * Runs `work` while holding an exclusive lock on this import, or resolves to `null` without
   * running it if another worker holds the lock.
   *
   * This — not the status column — is what makes concurrent delivery safe. A PostgreSQL advisory
   * lock is released automatically when the holding connection dies, so a crashed worker frees its
   * import immediately instead of blocking it until some lease expires.
   */
  withImportLock: <T>(id: ImportId, work: () => Promise<T>) => Promise<T | null>;
}

export interface SaveTransactionsResult {
  /** Rows that did not already exist. */
  readonly inserted: number;
  /** Rows already present under the same natural key. Expected, and the proof idempotency works. */
  readonly skipped: number;
}

export interface TransactionPageQuery {
  readonly walletId: WalletId;
  readonly limit: number;
  /** Opaque keyset cursor from a previous page, or null for the first page. */
  readonly cursor: TransactionCursor | null;
}

export interface TransactionCursor {
  readonly occurredAt: Date;
  readonly externalId: ExternalId;
}

export interface TransactionPage {
  readonly items: readonly Transaction[];
  readonly nextCursor: TransactionCursor | null;
}

export interface TransactionRepository {
  /**
   * Writes a batch of transactions and their entries in one database transaction, skipping any
   * whose natural key already exists. Safe to call twice with the same input (FR-6).
   */
  saveBatch: (transactions: readonly Transaction[]) => Promise<SaveTransactionsResult>;
  listByWallet: (query: TransactionPageQuery) => Promise<TransactionPage>;
}
