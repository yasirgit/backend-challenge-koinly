import {
  TransactionId,
  createImportNormalizer,
  type AssetRef,
  type ImportCounts,
  type ImportId,
  type ImportRecord,
  type TransactionDraft,
} from '@app/domain';

import { ConcurrencyError, NotFoundError, ValidationError, describeError, isRetryable } from '../errors.js';
import type { AssetResolver, ImportRepository, TransactionRepository } from '../ports/repositories.js';
import type { SourceRegistry } from '../ports/sources.js';
import type { Clock, IdGenerator } from '../ports/system.js';

export interface ProcessImportCommand {
  readonly importId: ImportId;
}

export type ProcessImportOutcome = 'completed' | 'already-completed';

export interface ProcessImportResult {
  readonly outcome: ProcessImportOutcome;
  readonly counts: ImportCounts;
}

export interface ProcessImportDeps {
  readonly imports: ImportRepository;
  readonly transactions: TransactionRepository;
  readonly assets: AssetResolver;
  readonly sources: SourceRegistry;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /**
   * Rows per database transaction. Bounds memory and lock duration: one transaction for a
   * hundred-thousand-row export is a long-running write that blocks vacuum and loses everything on
   * a single failure.
   */
  readonly batchSize: number;
}

export interface ProcessImportUseCase {
  execute: (command: ProcessImportCommand) => Promise<ProcessImportResult>;
}

const EMPTY_COUNTS: ImportCounts = { total: 0, imported: 0, skipped: 0 };

async function* chunked<T>(source: AsyncIterable<T>, size: number): AsyncGenerator<T[]> {
  let batch: T[] = [];
  for await (const item of source) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

const assetRefsOf = (drafts: readonly TransactionDraft[]): readonly AssetRef[] =>
  drafts.flatMap((draft) => draft.legs.map((leg) => leg.asset));

/**
 * The worker's unit of work: read a payload, normalize it, persist it, and record the outcome.
 *
 * Everything here is written to be safe to run twice. That is not a nicety — delivery is
 * at-least-once, so running twice is the normal case, not the exceptional one.
 */
export const createProcessImportUseCase = (deps: ProcessImportDeps): ProcessImportUseCase => {
  const runAttempt = async (record: ImportRecord): Promise<ProcessImportResult> => {
    const adapter = deps.sources.get(record.sourceType);
    if (adapter === null) {
      // Permanent: no amount of retrying will register the adapter.
      throw new ValidationError(`No adapter is registered for source ${record.sourceType}`, {
        sourceType: record.sourceType,
        known: deps.sources.list(),
      });
    }

    await deps.imports.beginAttempt(record.id, deps.clock.now());

    const normalizer = createImportNormalizer({
      walletId: record.walletId,
      sourceType: record.sourceType,
      importId: record.id,
      newTransactionId: () => TransactionId(deps.ids.newId()),
    });

    let total = 0;
    let imported = 0;
    let skipped = 0;

    try {
      for await (const drafts of chunked(adapter.read(record.payloadRef), deps.batchSize)) {
        const assetIds = await deps.assets.resolve(assetRefsOf(drafts));
        const saved = await deps.transactions.saveBatch(normalizer.normalize(drafts, assetIds));

        total += drafts.length;
        imported += saved.inserted;
        skipped += saved.skipped;
      }
    } catch (error: unknown) {
      // Only permanent failures are recorded as terminal. A transient one leaves the import in
      // `processing` and rethrows, so the redelivered message picks it up again; marking it failed
      // would turn a database blip into a lost import.
      if (!isRetryable(error)) {
        await deps.imports.fail(record.id, describeError(error), deps.clock.now());
      }
      throw error;
    }

    const counts: ImportCounts = { total, imported, skipped };
    await deps.imports.complete(record.id, counts, deps.clock.now());
    return { outcome: 'completed', counts };
  };

  return {
    execute: async (command) => {
      const record = await deps.imports.findById(command.importId);
      if (record === null) {
        // The message names an import that does not exist. Retrying cannot conjure it, and the
        // likeliest cause is a message that outlived its data.
        throw new NotFoundError('Import not found', { importId: command.importId });
      }

      // A duplicate delivery of an import that already finished. This is the common case for a
      // redelivered message and it must be cheap and silent.
      if (record.status === 'completed') {
        return { outcome: 'already-completed', counts: record.counts ?? EMPTY_COUNTS };
      }

      const result = await deps.imports.withImportLock(record.id, () => runAttempt(record));
      if (result === null) {
        // Another worker is on it. Retryable, so the message goes back with a delay rather than
        // racing; whichever worker holds the lock will finish the job.
        throw new ConcurrencyError('Import is already being processed', {
          importId: command.importId,
        });
      }

      return result;
    },
  };
};
