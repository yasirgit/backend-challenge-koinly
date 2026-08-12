import { NotFoundError, type ImportRepository } from '@app/application';
import type { ImportCounts, ImportFailure, ImportId, ImportRecord, UserId } from '@app/domain';
import { sql } from 'kysely';

import type { AppDatabase } from '../client.js';
import { toImportRecord } from './mappers.js';

/**
 * Namespace for advisory locks taken by this application, so a lock on an import cannot collide
 * with one taken elsewhere for an unrelated purpose.
 */
const IMPORT_LOCK_NAMESPACE = 4711;

export class PostgresImportRepository implements ImportRepository {
  constructor(private readonly db: AppDatabase) {}

  async create(record: ImportRecord): Promise<{ record: ImportRecord; created: boolean }> {
    const inserted = await this.db
      .insertInto('imports')
      .values({
        id: record.id,
        user_id: record.userId,
        wallet_id: record.walletId,
        source_type: record.sourceType,
        payload_ref: record.payloadRef,
        idempotency_key: record.idempotencyKey,
        request_fingerprint: record.requestFingerprint,
        status: record.status,
        rows_total: null,
        rows_imported: null,
        rows_skipped: null,
        error: null,
        started_at: null,
        finished_at: null,
      })
      .onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) {
      return { record: toImportRecord(inserted), created: true };
    }

    // Lost the race against a concurrent request carrying the same key. The winner's row is the
    // answer for both callers.
    const existing = await this.findByIdempotencyKey(record.userId, record.idempotencyKey);
    if (existing === null) {
      throw new Error('Import insert conflicted but the conflicting row could not be read');
    }
    return { record: existing, created: false };
  }

  async findById(id: ImportId): Promise<ImportRecord | null> {
    const row = await this.db
      .selectFrom('imports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toImportRecord(row);
  }

  async findByIdempotencyKey(
    userId: UserId,
    idempotencyKey: string,
  ): Promise<ImportRecord | null> {
    const row = await this.db
      .selectFrom('imports')
      .selectAll()
      .where('user_id', '=', userId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();

    return row === undefined ? null : toImportRecord(row);
  }

  async beginAttempt(id: ImportId, startedAt: Date): Promise<ImportRecord> {
    const row = await this.db
      .updateTable('imports')
      .set((eb) => ({
        status: 'processing' as const,
        attempts: eb('attempts', '+', 1),
        started_at: startedAt,
        finished_at: null,
        error: null,
      }))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (row === undefined) {
      throw new NotFoundError('Import not found', { importId: id });
    }
    return toImportRecord(row);
  }

  async complete(id: ImportId, counts: ImportCounts, finishedAt: Date): Promise<void> {
    await this.db
      .updateTable('imports')
      .set({
        status: 'completed',
        rows_total: counts.total,
        rows_imported: counts.imported,
        rows_skipped: counts.skipped,
        error: null,
        finished_at: finishedAt,
      })
      .where('id', '=', id)
      .execute();
  }

  async fail(id: ImportId, failure: ImportFailure, finishedAt: Date): Promise<void> {
    await this.db
      .updateTable('imports')
      .set({
        status: 'failed',
        error: JSON.stringify(failure),
        finished_at: finishedAt,
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Mutual exclusion for one import, using a PostgreSQL session-level advisory lock.
   *
   * Why not a lease on the status column: RabbitMQ redelivers the moment a channel drops, so the
   * replacement worker arrives seconds after the crash — long before any lease that was safe for a
   * slow-but-alive worker would expire. It would either refuse to take over a job nobody owns, or
   * take over one that is still running. An advisory lock has neither problem: it is held by a
   * connection, and a dead connection releases it immediately.
   *
   * Session-level rather than transaction-level because the work spans several transactions, one
   * per chunk. The lock is taken on its own connection and released in a `finally`; if the process
   * dies first, PostgreSQL drops it with the connection.
   */
  async withImportLock<T>(id: ImportId, work: () => Promise<T>): Promise<T | null> {
    return this.db.connection().execute(async (connection) => {
      const acquired = await sql<{ locked: boolean }>`
        select pg_try_advisory_lock(${IMPORT_LOCK_NAMESPACE}, hashtext(${id})) as locked
      `.execute(connection);

      if (acquired.rows[0]?.locked !== true) {
        return null;
      }

      try {
        return await work();
      } finally {
        await sql`
          select pg_advisory_unlock(${IMPORT_LOCK_NAMESPACE}, hashtext(${id}))
        `.execute(connection);
      }
    });
  }
}
