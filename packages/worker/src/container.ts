import { createProcessImportUseCase, describeError, type ProcessImportUseCase } from '@app/application';
import {
  PostgresAssetResolver,
  PostgresImportRepository,
  PostgresTransactionRepository,
  connectBroker,
  createDatabase,
  createLogger,
  createSourceRegistry,
  loadConfig,
  startImportConsumer,
  systemClock,
  uuidV7Generator,
  type AppConfig,
  type AppLogger,
  type ConsumerHandle,
} from '@app/infrastructure';

import { createImportHandler } from './import-handler.js';

/**
 * The worker's composition root. Like the API's, this is the only module here permitted to name a
 * concrete adapter.
 */
export interface WorkerContainer {
  readonly config: AppConfig;
  readonly logger: AppLogger;
  readonly processImport: ProcessImportUseCase;
  readonly start: () => Promise<ConsumerHandle>;
  /** Fires when the broker connection drops unprompted. See BrokerHandle.onLost. */
  readonly onBrokerLost: (handler: () => void) => void;
  readonly close: () => Promise<void>;
}

/** Rows per database transaction. See ProcessImportDeps.batchSize for why chunking matters. */
const IMPORT_BATCH_SIZE = 500;

export const createWorkerContainer = async (): Promise<WorkerContainer> => {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, service: 'worker' });

  const database = createDatabase(config.database);
  const broker = await connectBroker({
    url: config.queue.url,
    retryDelayMs: config.queue.retryDelayMs,
    logger,
  });

  const imports = new PostgresImportRepository(database.db);
  const processImport = createProcessImportUseCase({
    imports,
    transactions: new PostgresTransactionRepository(database.db),
    assets: new PostgresAssetResolver(database.db),
    sources: createSourceRegistry({ fixturesDir: config.sources.fixturesDir }),
    clock: systemClock,
    ids: uuidV7Generator,
    batchSize: IMPORT_BATCH_SIZE,
  });

  return {
    config,
    logger,
    processImport,
    start: () =>
      startImportConsumer({
        channel: broker.channel,
        logger,
        prefetch: config.queue.prefetch,
        maxAttempts: config.queue.maxAttempts,
        handle: createImportHandler(processImport),
        onDeadLetter: async (job, reason, error) => {
          // The consumer decides a message is finished with; this is where that decision becomes
          // visible to whoever asks about the import. Without it, a parked message would leave an
          // import stuck in `processing` forever with no explanation.
          if (job === null) {
            return;
          }
          const described = describeError(error);
          await imports.fail(
            job.importId,
            {
              code: described.code,
              message: described.message,
              details: { ...described.details, deadLetterReason: reason },
            },
            systemClock.now(),
          );
        },
      }),
    onBrokerLost: broker.onLost,
    close: async () => {
      await Promise.allSettled([broker.close(), database.close()]);
    },
  };
};
