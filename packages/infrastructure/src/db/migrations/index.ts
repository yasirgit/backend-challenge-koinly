import type { Migration, MigrationProvider } from 'kysely';

import * as initialSchema from './0001-initial-schema.js';

/**
 * Migrations are listed explicitly rather than discovered from disk. Kysely's file provider reads
 * the directory at runtime, which means the migration set depends on how the process was started
 * and on paths that differ between `tsx` and the compiled image. A static list runs the same
 * everywhere, and a missing migration is a compile error rather than a silent no-op.
 */
const migrations: Record<string, Migration> = {
  '0001-initial-schema': initialSchema,
};

export const migrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
};
