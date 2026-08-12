import {
  createGetImportUseCase,
  createListTransactionsUseCase,
  createRegisterWalletUseCase,
  createRequestImportUseCase,
} from '@app/application';
import {
  PostgresImportRepository,
  PostgresTransactionRepository,
  PostgresWalletRepository,
  RabbitImportJobPublisher,
  connectBroker,
  createDatabase,
  createLogger,
  createSourceRegistry,
  loadConfig,
  systemClock,
  uuidV7Generator,
  type AppConfig,
  type AppLogger,
} from '@app/infrastructure';

import type { ApiUseCases } from './server.js';

/**
 * The composition root: the one module in this package allowed to name a concrete adapter.
 *
 * Everything above it — routes, serializers, the server itself — depends on interfaces, which is
 * what makes the layering more than a folder convention. A dependency-cruiser rule enforces it, so
 * a route reaching for a repository fails the build rather than a review.
 */
export interface ApiContainer {
  readonly config: AppConfig;
  readonly logger: AppLogger;
  readonly useCases: ApiUseCases;
  readonly checkReadiness: () => Promise<{ ok: boolean; checks: Record<string, boolean> }>;
  readonly close: () => Promise<void>;
}

export const createApiContainer = async (): Promise<ApiContainer> => {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, service: 'api' });

  const database = createDatabase(config.database);
  const broker = await connectBroker({
    url: config.queue.url,
    retryDelayMs: config.queue.retryDelayMs,
    logger,
  });

  const wallets = new PostgresWalletRepository(database.db);
  const imports = new PostgresImportRepository(database.db);
  const transactions = new PostgresTransactionRepository(database.db);
  const publisher = new RabbitImportJobPublisher(broker.channel, systemClock, uuidV7Generator);
  const sources = createSourceRegistry({ fixturesDir: config.sources.fixturesDir });

  return {
    config,
    logger,
    useCases: {
      registerWallet: createRegisterWalletUseCase({ wallets, sources, ids: uuidV7Generator }),
      requestImport: createRequestImportUseCase({
        wallets,
        imports,
        publisher,
        clock: systemClock,
        ids: uuidV7Generator,
      }),
      getImport: createGetImportUseCase({ imports }),
      listTransactions: createListTransactionsUseCase({ wallets, transactions }),
    },
    checkReadiness: async () => {
      // Readiness is about serving traffic, so it checks the dependencies a request actually needs:
      // intake cannot accept an import without both the database and the broker.
      const checks = { postgres: await database.ping(), rabbitmq: broker.isOpen() };
      return { ok: Object.values(checks).every(Boolean), checks };
    },
    close: async () => {
      await Promise.allSettled([broker.close(), database.close()]);
    },
  };
};
