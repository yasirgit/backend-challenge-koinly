import { Migrator, type MigrationResultSet } from 'kysely';

import type { AppDatabase } from './client.js';
import { migrationProvider } from './migrations/index.js';

/**
 * Kysely's migrator takes a lock on its own bookkeeping table before running, so two containers
 * starting at once cannot apply the same migration twice. That matters here because compose starts
 * the migrate service alongside everything else, and in production several replicas may race.
 */
export const createMigrator = (db: AppDatabase): Migrator =>
  new Migrator({ db, provider: migrationProvider });

export const migrateToLatest = async (db: AppDatabase): Promise<MigrationResultSet> =>
  createMigrator(db).migrateToLatest();

export const migrateDown = async (db: AppDatabase): Promise<MigrationResultSet> =>
  createMigrator(db).migrateDown();
