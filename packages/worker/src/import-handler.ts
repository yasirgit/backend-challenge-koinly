import type { ImportRequestedJob, ProcessImportUseCase } from '@app/application';

export interface Logger {
  info: (details: Record<string, unknown>, message: string) => void;
}

/**
 * The message handler: unwraps a job and hands it to the use case.
 *
 * Deliberately almost empty. Everything that could go wrong — locking, retry classification,
 * idempotency — belongs to the use case or the consumer, and neither of those needs a broker or an
 * HTTP request to be tested. If this file ever grows logic, something has leaked out of a layer
 * where it could be tested cheaply.
 */
export const createImportHandler =
  (processImport: ProcessImportUseCase) =>
  async (job: ImportRequestedJob, logger: Logger): Promise<void> => {
    const result = await processImport.execute({ importId: job.importId });
    logger.info(
      { outcome: result.outcome, ...result.counts },
      result.outcome === 'already-completed'
        ? 'duplicate delivery ignored'
        : 'import processed',
    );
  };
