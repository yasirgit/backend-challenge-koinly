import { Decimal } from '@app/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './client.js';
import { connectTestDatabase } from '../testing/test-database.js';

/**
 * The guardrail for the entire money story (FR-8, ADR-0004).
 *
 * Everything else about exact decimals is a claim about our own code. This is the one test that
 * checks the two things we do not control: that PostgreSQL stores what we sent, and that the driver
 * hands it back as a string rather than parsing it into a double on the way.
 */
describe('NUMERIC(38,18) fidelity', () => {
  let database: DatabaseHandle;

  beforeAll(async () => {
    database = await connectTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  const roundTrip = async (value: string): Promise<unknown> => {
    const { rows } = await sql<{ value: unknown }>`
      select ${value}::numeric(38,18) as value
    `.execute(database.db);
    return rows[0]?.value;
  };

  it('returns numerics as strings, not JavaScript numbers', async () => {
    // If this ever fails, every quantity in the system has been through a double and the exactness
    // argument is gone. Hence the explicit type parser in client.ts rather than trusting a default.
    expect(typeof (await roundTrip('1.5'))).toBe('string');
  });

  it('preserves the smallest storable amount', async () => {
    expect(await roundTrip('0.000000000000000001')).toBe('0.000000000000000001');
  });

  it('preserves a full-width value', async () => {
    const full = '12345678901234567890.123456789012345678';
    expect(await roundTrip(full)).toBe(full);
  });

  it('preserves a value that a float would mangle', async () => {
    // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004.
    const { rows } = await sql<{ total: string }>`
      select (0.1::numeric(38,18) + 0.2::numeric(38,18)) as total
    `.execute(database.db);
    expect(Decimal.from(rows[0]!.total).toString()).toBe('0.3');
  });

  it('rounds silently when the scale is exceeded, which is why the domain rejects it first', async () => {
    // Documenting the hazard rather than the happy path: PostgreSQL does not error here, it rounds.
    // A value that gets this far has already lost precision, so Decimal.from refuses it earlier.
    expect(await roundTrip('0.0000000000000000004')).toBe('0.000000000000000000');
    expect(() => Decimal.from('0.0000000000000000004')).toThrow();
  });
});
