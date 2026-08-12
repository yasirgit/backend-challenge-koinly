import {
  Decimal,
  ExternalId,
  ImportId,
  TransactionId,
  createImport,
  createTransaction,
  type AssetId,
  type ImportRecord,
  type Transaction,
  type UserId,
  type Wallet,
} from '@app/domain';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import type {
  ImportRepository,
  TransactionRepository,
  WalletRepository,
} from '../ports/repositories.js';

/**
 * The contract every repository implementation must satisfy, written once and executed against
 * each of them: the in-memory fakes and the PostgreSQL adapters.
 *
 * This is what makes it honest to test use cases against fakes. A fake that passes the same
 * assertions as the real adapter is a substitute; without this suite it is just a restatement of
 * what the author assumed the database does, and the first surprise shows up in production.
 */

export interface RepositoryContractSubject {
  readonly wallets: WalletRepository;
  readonly imports: ImportRepository;
  readonly transactions: TransactionRepository;
}

export interface RepositoryContractFixture {
  readonly subject: RepositoryContractSubject;
  /** A tenant nothing else in the suite touches, so tests can share a database safely. */
  readonly userId: UserId;
  readonly wallet: Wallet;
  readonly assetIds: readonly AssetId[];
  readonly dispose?: () => Promise<void>;
}

export const describeRepositoryContract = (
  implementationName: string,
  createFixture: () => Promise<RepositoryContractFixture>,
): void => {
  describe(`${implementationName} repository contract`, () => {
    let fixture: RepositoryContractFixture;

    beforeAll(async () => {
      fixture = await createFixture();
    });

    afterAll(async () => {
      await fixture.dispose?.();
    });

    /**
     * A run-scoped identifier, valid as a UUID and distinct from every other run's.
     *
     * The integration tier points at a long-lived database that nothing truncates, so a suite with
     * hardcoded primary keys is green exactly once and then fails on a duplicate key until someone
     * recreates the container. Borrowing the random tail of the fixture's user keeps ids
     * deterministic within a run — which is what makes failures reproducible — without making the
     * suite depend on the database being empty.
     */
    const id = (suffix: string): string => {
      const run = fixture.userId.replaceAll('-', '').slice(-8);
      return `01900000-0000-7000-8000-${run}${suffix.padStart(4, '0')}`;
    };

    const importRecord = (overrides: { id?: string; key?: string } = {}): ImportRecord =>
      createImport({
        id: ImportId(overrides.id ?? id('f001')),
        userId: fixture.userId,
        walletId: fixture.wallet.id,
        sourceType: fixture.wallet.sourceType,
        payloadRef: 'acme-exchange/trades.csv',
        idempotencyKey: overrides.key ?? 'contract-key-1',
        requestFingerprint: 'fingerprint-1',
        createdAt: new Date('2024-06-01T12:00:00.000Z'),
      });

    const transaction = (options: {
      id: string;
      externalId: string;
      occurredAt: string;
      quantity?: string;
    }): Transaction =>
      createTransaction({
        id: TransactionId(options.id),
        walletId: fixture.wallet.id,
        importId: null,
        externalId: ExternalId(options.externalId),
        externalIdKind: 'source',
        kind: 'deposit',
        occurredAt: new Date(options.occurredAt),
        sourceType: fixture.wallet.sourceType,
        entries: [
          {
            direction: 'in',
            assetId: fixture.assetIds[0]!,
            quantity: Decimal.from(options.quantity ?? '1.5'),
          },
        ],
      });

    describe('wallets', () => {
      it('returns the existing wallet when the same identity is registered again', async () => {
        const again = await fixture.subject.wallets.create(fixture.wallet);
        expect(again.created).toBe(false);
        expect(again.wallet.id).toBe(fixture.wallet.id);
      });

      it('finds a wallet by identity and by id', async () => {
        const byId = await fixture.subject.wallets.findById(fixture.wallet.id);
        const byIdentity = await fixture.subject.wallets.findByIdentity(
          fixture.userId,
          fixture.wallet.sourceType,
          fixture.wallet.sourceAccountRef,
        );
        expect(byId?.id).toBe(fixture.wallet.id);
        expect(byIdentity?.id).toBe(fixture.wallet.id);
      });

      it('returns null for a wallet that does not exist', async () => {
        const missing = await fixture.subject.wallets.findById(
          id('00ff') as Wallet['id'],
        );
        expect(missing).toBeNull();
      });
    });

    describe('imports', () => {
      it('is idempotent on the tenant-scoped idempotency key', async () => {
        const record = importRecord({ id: id('f010'), key: 'key-a' });

        const first = await fixture.subject.imports.create(record);
        const second = await fixture.subject.imports.create({
          ...record,
          id: ImportId(id('f011')),
        });

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.record.id).toBe(first.record.id);
      });

      it('walks an import through its lifecycle', async () => {
        const record = importRecord({ id: id('f020'), key: 'key-b' });
        await fixture.subject.imports.create(record);

        const started = await fixture.subject.imports.beginAttempt(record.id, new Date());
        expect(started.status).toBe('processing');
        expect(started.attempts).toBe(1);

        await fixture.subject.imports.complete(
          record.id,
          { total: 3, imported: 2, skipped: 1 },
          new Date(),
        );

        const completed = await fixture.subject.imports.findById(record.id);
        expect(completed?.status).toBe('completed');
        expect(completed?.counts).toStrictEqual({ total: 3, imported: 2, skipped: 1 });
      });

      it('records a structured failure', async () => {
        const record = importRecord({ id: id('f030'), key: 'key-c' });
        await fixture.subject.imports.create(record);

        await fixture.subject.imports.fail(
          record.id,
          { code: 'UNKNOWN_ASSET', message: 'Asset SCAM@- is not in the registry' },
          new Date(),
        );

        const failed = await fixture.subject.imports.findById(record.id);
        expect(failed?.status).toBe('failed');
        expect(failed?.error?.code).toBe('UNKNOWN_ASSET');
      });

      it('lets only one holder into the lock at a time', async () => {
        const record = importRecord({ id: id('f040'), key: 'key-d' });
        await fixture.subject.imports.create(record);

        let release = (): void => undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });

        const first = fixture.subject.imports.withImportLock(record.id, async () => {
          await held;
          return 'first';
        });

        // Give the first holder a chance to take the lock before the contender arrives.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const contender = await fixture.subject.imports.withImportLock(record.id, () =>
          Promise.resolve('second'),
        );

        expect(contender).toBeNull();
        release();
        expect(await first).toBe('first');

        // Released afterwards, so the import is not stuck.
        const afterRelease = await fixture.subject.imports.withImportLock(record.id, () =>
          Promise.resolve('third'),
        );
        expect(afterRelease).toBe('third');
      });
    });

    describe('transactions', () => {
      it('inserts a batch and skips rows that already exist', async () => {
        const batch = [
          transaction({
            id: id('0201'),
            externalId: 'contract-tx-1',
            occurredAt: '2024-03-01T10:00:00.000Z',
          }),
          transaction({
            id: id('0202'),
            externalId: 'contract-tx-2',
            occurredAt: '2024-03-02T10:00:00.000Z',
          }),
        ];

        const first = await fixture.subject.transactions.saveBatch(batch);
        expect(first).toStrictEqual({ inserted: 2, skipped: 0 });

        // The same payload again, with fresh surrogate ids: the natural key decides, not the id.
        const replay = await fixture.subject.transactions.saveBatch(
          batch.map((item, index) => ({
            ...item,
            id: TransactionId(id(`031${String(index)}`)),
          })),
        );
        expect(replay).toStrictEqual({ inserted: 0, skipped: 2 });
      });

      it('round-trips a quantity without losing a digit', async () => {
        // The reason this is in the contract rather than in a PostgreSQL-only test: the promise
        // "an amount comes back exactly as it went in" belongs to the port, so every implementation
        // has to keep it (FR-8).
        const exact = '0.000000000000000001';
        await fixture.subject.transactions.saveBatch([
          transaction({
            id: id('0210'),
            externalId: 'contract-tx-precise',
            occurredAt: '2024-04-01T10:00:00.000Z',
            quantity: exact,
          }),
        ]);

        const page = await fixture.subject.transactions.listByWallet({
          walletId: fixture.wallet.id,
          limit: 100,
          cursor: null,
        });
        const stored = page.items.find((item) => item.externalId === 'contract-tx-precise');

        expect(stored?.entries[0]?.quantity.toString()).toBe(exact);
      });

      it('pages through every row exactly once, newest first', async () => {
        const walletId = fixture.wallet.id;
        const all = new Map<string, Transaction>();

        let cursor = null as Awaited<
          ReturnType<TransactionRepository['listByWallet']>
        >['nextCursor'];
        let guard = 0;

        do {
          const page = await fixture.subject.transactions.listByWallet({
            walletId,
            limit: 2,
            cursor,
          });
          for (const item of page.items) {
            expect(all.has(item.externalId), `duplicate row ${item.externalId}`).toBe(false);
            all.set(item.externalId, item);
          }
          cursor = page.nextCursor;
          guard += 1;
        } while (cursor !== null && guard < 50);

        expect(cursor).toBeNull();

        const timestamps = [...all.values()].map((item) => item.occurredAt.getTime());
        expect(timestamps).toStrictEqual([...timestamps].sort((a, b) => b - a));
      });

      it('reads back entries in their recorded order', async () => {
        const page = await fixture.subject.transactions.listByWallet({
          walletId: fixture.wallet.id,
          limit: 1,
          cursor: null,
        });
        const entries = page.items[0]?.entries ?? [];
        expect(entries.map((entry) => entry.entryIndex)).toStrictEqual(
          entries.map((_, index) => index),
        );
      });
    });
  });
};
