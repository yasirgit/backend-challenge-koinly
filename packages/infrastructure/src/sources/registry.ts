import type { SourceAdapter, SourceRegistry } from '@app/application';
import type { SourceType } from '@app/domain';

import { AcmeExchangeCsvAdapter } from './acme-exchange-csv.adapter.js';
import { FakeChainJsonAdapter } from './fake-chain-json.adapter.js';
import { FixturePayloadStore } from './payload-store.js';

class StaticSourceRegistry implements SourceRegistry {
  private readonly adapters: ReadonlyMap<string, SourceAdapter>;

  constructor(adapters: readonly SourceAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.sourceType, adapter]));
  }

  get(sourceType: SourceType): SourceAdapter | null {
    return this.adapters.get(sourceType) ?? null;
  }

  list(): readonly SourceType[] {
    return [...this.adapters.keys()] as SourceType[];
  }
}

/**
 * Adding an exchange is this list plus one file. Nothing in the domain, the application layer or
 * the database schema changes — which is the property the two very different adapters were written
 * to demonstrate.
 */
export const createSourceRegistry = (options: { readonly fixturesDir: string }): SourceRegistry => {
  const store = new FixturePayloadStore(options.fixturesDir);
  return new StaticSourceRegistry([
    new AcmeExchangeCsvAdapter(store),
    new FakeChainJsonAdapter(store),
  ]);
};
