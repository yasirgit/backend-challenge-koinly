import type {
  SaveTransactionsResult,
  TransactionPage,
  TransactionPageQuery,
  TransactionRepository,
} from '@app/application';
import type { Transaction } from '@app/domain';
import { sql } from 'kysely';

import type { AppDatabase } from '../client.js';
import { toTransaction } from './mappers.js';

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Writes a batch and its entries in one database transaction.
   *
   * `on conflict do nothing ... returning id` does the idempotency work: the returned ids are
   * exactly the transactions that did not already exist, so entries are written only for those and
   * a replay is a genuine no-op rather than a constraint violation to catch and ignore.
   */
  async saveBatch(transactions: readonly Transaction[]): Promise<SaveTransactionsResult> {
    if (transactions.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    return this.db.transaction().execute(async (trx) => {
      const insertedRows = await trx
        .insertInto('transactions')
        .values(
          transactions.map((transaction) => ({
            id: transaction.id,
            wallet_id: transaction.walletId,
            import_id: transaction.importId,
            external_id: transaction.externalId,
            external_id_kind: transaction.externalIdKind,
            kind: transaction.kind,
            occurred_at: transaction.occurredAt,
            source_type: transaction.sourceType,
          })),
        )
        .onConflict((oc) => oc.columns(['wallet_id', 'external_id']).doNothing())
        .returning('id')
        .execute();

      const insertedIds = new Set(insertedRows.map((row) => row.id));
      const entries = transactions
        .filter((transaction) => insertedIds.has(transaction.id))
        .flatMap((transaction) =>
          transaction.entries.map((entry) => ({
            transaction_id: transaction.id,
            entry_index: entry.entryIndex,
            wallet_id: transaction.walletId,
            direction: entry.direction,
            asset_id: entry.assetId,
            // String in, string out. The moment this becomes a number the exactness argument dies.
            quantity: entry.quantity.toString(),
          })),
        );

      if (entries.length > 0) {
        await trx.insertInto('transaction_entries').values(entries).execute();
      }

      return {
        inserted: insertedIds.size,
        skipped: transactions.length - insertedIds.size,
      };
    });
  }

  /**
   * Keyset pagination over `(occurred_at desc, external_id desc)`, matching the index.
   *
   * Offset pagination would drift as new imports land; the tie-break is `external_id` rather than
   * the primary key because it is derived from content, so the order is the same after a re-import.
   */
  async listByWallet(query: TransactionPageQuery): Promise<TransactionPage> {
    let statement = this.db
      .selectFrom('transactions')
      .selectAll()
      .where('wallet_id', '=', query.walletId)
      .orderBy('occurred_at', 'desc')
      .orderBy('external_id', 'desc')
      // One extra row is the cheapest way to know whether another page exists.
      .limit(query.limit + 1);

    if (query.cursor !== null) {
      const { occurredAt, externalId } = query.cursor;
      statement = statement.where(
        sql<boolean>`(occurred_at, external_id) < (${occurredAt}, ${externalId})`,
      );
    }

    const rows = await statement.execute();
    const pageRows = rows.slice(0, query.limit);

    if (pageRows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const entryRows = await this.db
      .selectFrom('transaction_entries')
      .selectAll()
      .where(
        'transaction_id',
        'in',
        pageRows.map((row) => row.id),
      )
      .execute();

    const entriesByTransaction = new Map<string, typeof entryRows>();
    for (const entry of entryRows) {
      const bucket = entriesByTransaction.get(entry.transaction_id) ?? [];
      bucket.push(entry);
      entriesByTransaction.set(entry.transaction_id, bucket);
    }

    const items = pageRows.map((row) =>
      toTransaction(row, entriesByTransaction.get(row.id) ?? []),
    );
    const last = pageRows.at(-1);

    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? { occurredAt: last.occurred_at, externalId: items.at(-1)!.externalId }
          : null,
    };
  }
}
