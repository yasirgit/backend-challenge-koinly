import { createDatabase, type DatabaseHandle } from '../db/client.js';
import { toError } from '../observability/to-error.js';
import { migrateToLatest } from '../db/migrator.js';

/**
 * Connects the integration tier to the containers started by `pnpm infra:up`.
 *
 * The URL is read here rather than through the config loader because these tests are not the
 * application: they need one setting, not a validated application configuration, and pointing the
 * suite at a different database should not require constructing the whole config object.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://koinly:koinly@localhost:55432/koinly_test';

export const TEST_RABBITMQ_URL =
  process.env['TEST_RABBITMQ_URL'] ?? 'amqp://koinly:koinly@localhost:55672';

/**
 * The retry delay every integration suite must declare.
 *
 * RabbitMQ treats queue arguments as immutable, so two suites asking for different TTLs on
 * imports.normalize.retry means whichever connects second is refused with a 406 — a failure that
 * depends on test ordering and says nothing about the code under test. Short, because the suites
 * that wait for a retry would rather not.
 */
export const TEST_RETRY_DELAY_MS = 200;

let migrated = false;

export const connectTestDatabase = async (): Promise<DatabaseHandle> => {
  const handle = createDatabase({ url: TEST_DATABASE_URL, poolMax: 5 });

  // Migrations run once per process. Kysely takes a lock on its own bookkeeping table, so this is
  // safe even when several suites connect at the same time.
  if (!migrated) {
    const { error } = await migrateToLatest(handle.db);
    if (error !== undefined) {
      throw toError(error);
    }
    migrated = true;
  }

  return handle;
};

/**
 * Integration tests share one database, so they scope their data to a fresh user rather than
 * truncating tables. Truncation between tests is a race waiting to happen and it makes a failing
 * test destroy the evidence of what it did.
 */
export const uniqueSuffix = (): string => Math.random().toString(16).slice(2, 10);
