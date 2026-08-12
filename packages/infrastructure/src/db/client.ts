import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';

import type { Database } from './schema.js';

/**
 * `NUMERIC` must arrive as a string.
 *
 * node-postgres already does this by default, which is exactly why it is pinned here: a default is
 * something a future dependency bump can change, and if it ever did, every quantity in the system
 * would quietly start round-tripping through an IEEE-754 double. This one line is the difference
 * between "we rely on a library default" and "we require this behaviour", and there is an
 * integration test asserting it (see ADR-0004).
 */
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (value: string) => value);

export type AppDatabase = Kysely<Database>;

export interface DatabaseHandle {
  readonly db: AppDatabase;
  readonly pool: Pool;
  /** Cheap liveness probe for the readiness endpoint. Never throws; reports false instead. */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

export const createDatabase = (options: {
  readonly url: string;
  readonly poolMax: number;
}): DatabaseHandle => {
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax,
    // A connection that cannot be obtained quickly is a signal to shed load, not to queue forever.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    pool,
    ping: async () => {
      try {
        await sql`select 1`.execute(db);
        return true;
      } catch {
        return false;
      }
    },
    close: async () => {
      await db.destroy();
    },
  };
};
