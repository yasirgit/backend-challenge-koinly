import type { AssetResolver } from '@app/application';
import { AssetId, assetRefKey, type AssetRef } from '@app/domain';
import { sql } from 'kysely';

import type { AppDatabase } from '../client.js';

/**
 * Resolves the tickers a payload mentions to registry identifiers.
 *
 * Read-only on purpose. Creating an asset because a payload mentioned an unfamiliar symbol would
 * also make the write path racy — two workers meeting the same new token would race on the unique
 * constraint — but the real reason is that a tax system should not invent assets (assumption A6).
 * An unresolved reference comes back missing, and the domain fails the row.
 */
export class PostgresAssetResolver implements AssetResolver {
  constructor(private readonly db: AppDatabase) {}

  async resolve(refs: readonly AssetRef[]): Promise<ReadonlyMap<string, AssetId>> {
    const unique = new Map<string, AssetRef>();
    for (const ref of refs) {
      unique.set(assetRefKey(ref), ref);
    }
    if (unique.size === 0) {
      return new Map();
    }

    const pairs = [...unique.values()].map((ref) => sql`(${ref.symbol}, ${ref.chain ?? ''})`);

    const { rows } = await sql<{ id: string; symbol: string; chain: string }>`
      select id, symbol, chain
      from assets
      where (symbol, chain) in (${sql.join(pairs)})
      -- Deterministic pick when one ticker on one chain has several contracts. Choosing a winner
      -- rather than failing is a stub: real disambiguation needs the contract address from the
      -- source, which the fixtures do not carry.
      order by contract_address asc
    `.execute(this.db);

    const resolved = new Map<string, AssetId>();
    for (const row of rows) {
      const key = assetRefKey({ symbol: row.symbol, chain: row.chain === '' ? null : row.chain });
      if (!resolved.has(key)) {
        resolved.set(key, AssetId(row.id));
      }
    }
    return resolved;
  }
}
