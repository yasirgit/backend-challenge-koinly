import {
  assetRefKey,
  type AssetId,
  type AssetRef,
  type ImportCounts,
  type ImportFailure,
  type ImportId,
  type ImportRecord,
  type SourceType,
  type Transaction,
  type UserId,
  type Wallet,
  type WalletId,
} from '@app/domain';

import { NotFoundError } from '../errors.js';
import type { ImportJobPublisher, ImportRequestedJob } from '../ports/messaging.js';
import type {
  AssetResolver,
  ImportRepository,
  SaveTransactionsResult,
  TransactionPage,
  TransactionPageQuery,
  TransactionRepository,
  WalletRepository,
} from '../ports/repositories.js';
import type { SourceAdapter, SourceRegistry } from '../ports/sources.js';
import type { Clock, IdGenerator } from '../ports/system.js';

/**
 * In-memory implementations of every port.
 *
 * These are not mocks. They are real, if simple, implementations, and the repository ones are held
 * to the same contract test suite as the PostgreSQL adapters (see ADR-0012). That is what makes it
 * legitimate to test use cases against them: a fake that passes the same assertions as the real
 * thing is a substitute, while a mock is just a restatement of what the author expected.
 */

export const fixedClock = (at = new Date('2024-06-01T12:00:00.000Z')): Clock & {
  advance: (ms: number) => void;
} => {
  let current = at;
  return {
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
};

/** Sequential, UUIDv7-shaped identifiers, so failures print something reproducible. */
export const sequentialIds = (prefix = 'aaaa'): IdGenerator => {
  let counter = 0;
  return {
    newId: () => {
      counter += 1;
      return `01900000-0000-7000-8000-${prefix}${counter.toString(16).padStart(8, '0')}`;
    },
  };
};

export class FakeWalletRepository implements WalletRepository {
  readonly items = new Map<string, Wallet>();

  findById(id: WalletId): Promise<Wallet | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByIdentity(
    userId: UserId,
    sourceType: SourceType,
    sourceAccountRef: string,
  ): Promise<Wallet | null> {
    const found = [...this.items.values()].find(
      (wallet) =>
        wallet.userId === userId &&
        wallet.sourceType === sourceType &&
        wallet.sourceAccountRef === sourceAccountRef,
    );
    return Promise.resolve(found ?? null);
  }

  async create(wallet: Wallet): Promise<{ wallet: Wallet; created: boolean }> {
    const existing = await this.findByIdentity(
      wallet.userId,
      wallet.sourceType,
      wallet.sourceAccountRef,
    );
    if (existing !== null) {
      return { wallet: existing, created: false };
    }
    this.items.set(wallet.id, wallet);
    return { wallet, created: true };
  }
}

export class FakeImportRepository implements ImportRepository {
  readonly items = new Map<string, ImportRecord>();
  /** Imports currently locked, mirroring the advisory lock the PostgreSQL adapter takes. */
  readonly locked = new Set<string>();

  #update(id: ImportId, patch: Partial<ImportRecord>): ImportRecord {
    const existing = this.items.get(id);
    if (existing === undefined) {
      throw new NotFoundError('Import not found', { importId: id });
    }
    const updated = { ...existing, ...patch };
    this.items.set(id, updated);
    return updated;
  }

  create(record: ImportRecord): Promise<{ record: ImportRecord; created: boolean }> {
    const existing = [...this.items.values()].find(
      (item) => item.userId === record.userId && item.idempotencyKey === record.idempotencyKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({ record: existing, created: false });
    }
    this.items.set(record.id, record);
    return Promise.resolve({ record, created: true });
  }

  findById(id: ImportId): Promise<ImportRecord | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  findByIdempotencyKey(userId: UserId, idempotencyKey: string): Promise<ImportRecord | null> {
    const found = [...this.items.values()].find(
      (item) => item.userId === userId && item.idempotencyKey === idempotencyKey,
    );
    return Promise.resolve(found ?? null);
  }

  beginAttempt(id: ImportId, startedAt: Date): Promise<ImportRecord> {
    const existing = this.items.get(id);
    return Promise.resolve(
      this.#update(id, {
        status: 'processing',
        attempts: (existing?.attempts ?? 0) + 1,
        startedAt,
        finishedAt: null,
        error: null,
      }),
    );
  }

  complete(id: ImportId, counts: ImportCounts, finishedAt: Date): Promise<void> {
    this.#update(id, { status: 'completed', counts, finishedAt, error: null });
    return Promise.resolve();
  }

  fail(id: ImportId, failure: ImportFailure, finishedAt: Date): Promise<void> {
    this.#update(id, { status: 'failed', error: failure, finishedAt });
    return Promise.resolve();
  }

  async withImportLock<T>(id: ImportId, work: () => Promise<T>): Promise<T | null> {
    if (this.locked.has(id)) {
      return null;
    }
    this.locked.add(id);
    try {
      return await work();
    } finally {
      this.locked.delete(id);
    }
  }
}

export class FakeTransactionRepository implements TransactionRepository {
  /** Keyed by the natural key, which is exactly what the unique constraint does in PostgreSQL. */
  readonly items = new Map<string, Transaction>();

  #key(transaction: Transaction): string {
    return `${transaction.walletId}::${transaction.externalId}`;
  }

  saveBatch(transactions: readonly Transaction[]): Promise<SaveTransactionsResult> {
    let inserted = 0;
    let skipped = 0;

    for (const transaction of transactions) {
      const key = this.#key(transaction);
      if (this.items.has(key)) {
        skipped += 1;
        continue;
      }
      this.items.set(key, transaction);
      inserted += 1;
    }

    return Promise.resolve({ inserted, skipped });
  }

  listByWallet(query: TransactionPageQuery): Promise<TransactionPage> {
    const ordered = [...this.items.values()]
      .filter((transaction) => transaction.walletId === query.walletId)
      .sort((left, right) => {
        const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
        return byTime !== 0 ? byTime : right.externalId.localeCompare(left.externalId);
      });

    const afterCursor =
      query.cursor === null
        ? ordered
        : ordered.filter((transaction) => {
            const cursor = query.cursor;
            if (cursor === null) {
              return true;
            }
            const byTime = transaction.occurredAt.getTime() - cursor.occurredAt.getTime();
            return byTime !== 0
              ? byTime < 0
              : transaction.externalId.localeCompare(cursor.externalId) < 0;
          });

    const items = afterCursor.slice(0, query.limit);
    const last = items.at(-1);
    const hasMore = afterCursor.length > items.length;

    return Promise.resolve({
      items,
      nextCursor:
        hasMore && last !== undefined
          ? { occurredAt: last.occurredAt, externalId: last.externalId }
          : null,
    });
  }
}

export class FakeAssetResolver implements AssetResolver {
  constructor(private readonly known: ReadonlyMap<string, AssetId>) {}

  resolve(refs: readonly AssetRef[]): Promise<ReadonlyMap<string, AssetId>> {
    const resolved = new Map<string, AssetId>();
    for (const ref of refs) {
      const key = assetRefKey(ref);
      const id = this.known.get(key);
      if (id !== undefined) {
        resolved.set(key, id);
      }
    }
    return Promise.resolve(resolved);
  }
}

export class FakeImportJobPublisher implements ImportJobPublisher {
  readonly published: ImportRequestedJob[] = [];
  /** Set to make the next publish fail, to exercise the persist-then-publish window. */
  failNext = false;

  publish(job: ImportRequestedJob): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('broker unavailable'));
    }
    this.published.push(job);
    return Promise.resolve();
  }
}

export class FakeSourceRegistry implements SourceRegistry {
  readonly adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): this {
    this.adapters.set(adapter.sourceType, adapter);
    return this;
  }

  get(sourceType: SourceType): SourceAdapter | null {
    return this.adapters.get(sourceType) ?? null;
  }

  list(): readonly SourceType[] {
    return [...this.adapters.keys()] as SourceType[];
  }
}
