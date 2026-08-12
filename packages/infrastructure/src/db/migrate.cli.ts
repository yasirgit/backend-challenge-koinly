import { loadConfig } from '../config/config.js';
import { createLogger } from '../observability/logger.js';
import { formatError, toError } from '../observability/to-error.js';
import { createDatabase } from './client.js';
import { migrateDown, migrateToLatest } from './migrator.js';

/**
 * One-shot migration command. Compose runs it to completion before the API and the worker start,
 * so the application never observes a schema it was not built against.
 */
const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, service: 'migrate' });
  const database = createDatabase(config.database);

  const direction = process.argv[2] ?? 'up';

  try {
    const { error, results } = await (direction === 'down'
      ? migrateDown(database.db)
      : migrateToLatest(database.db));

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        logger.info({ migration: result.migrationName, direction }, 'migration applied');
      } else if (result.status === 'Error') {
        logger.error({ migration: result.migrationName, direction }, 'migration failed');
      }
    }

    if (error !== undefined) {
      throw toError(error);
    }

    logger.info({ direction }, 'schema is up to date');
  } finally {
    await database.close();
  }
};

main().catch((error: unknown) => {
  // Nothing structured is available yet if configuration itself failed, so this deliberately falls
  // back to stderr rather than assuming a logger exists.
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
