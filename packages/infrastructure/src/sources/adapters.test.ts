import { ValidationError } from '@app/application';
import { assignExternalIds, SourceType, WalletId, type TransactionDraft } from '@app/domain';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AcmeExchangeCsvAdapter } from './acme-exchange-csv.adapter.js';
import { FakeChainJsonAdapter } from './fake-chain-json.adapter.js';
import { FixturePayloadStore } from './payload-store.js';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures', import.meta.url));
const store = new FixturePayloadStore(FIXTURES);

const collect = async (source: AsyncIterable<TransactionDraft>): Promise<TransactionDraft[]> => {
  const drafts: TransactionDraft[] = [];
  for await (const draft of source) {
    drafts.push(draft);
  }
  return drafts;
};

describe('the exchange CSV adapter', () => {
  const adapter = new AcmeExchangeCsvAdapter(store);

  it('turns a buy into an incoming, an outgoing and a fee leg', async () => {
    const [first] = await collect(adapter.read('acme-exchange/trades.csv'));

    expect(first?.sourceId).toBe('T-1001');
    expect(first?.kind).toBe('trade');
    expect(first?.legs.map((leg) => [leg.direction, leg.asset.symbol, leg.quantity.toString()]))
      .toStrictEqual([
        ['in', 'ETH', '0.5'],
        ['out', 'USDC', '1200'],
        ['fee', 'USDC', '1.2'],
      ]);
  });

  it('inverts the legs for a sell', async () => {
    const drafts = await collect(adapter.read('acme-exchange/trades.csv'));
    const sell = drafts.find((draft) => draft.sourceId === 'T-1003');

    expect(sell?.legs[0]).toMatchObject({ direction: 'out' });
    expect(sell?.legs[0]?.asset.symbol).toBe('ETH');
    expect(sell?.legs[1]).toMatchObject({ direction: 'in' });
  });

  it('omits a fee leg when the export has no fee', async () => {
    const drafts = await collect(adapter.read('acme-exchange/trades.csv'));
    const noFee = drafts.find((draft) => draft.sourceId === 'T-1008');

    expect(noFee?.legs).toHaveLength(2);
  });

  it('keeps eighteen decimal places from the file', async () => {
    const drafts = await collect(adapter.read('acme-exchange/trades.csv'));
    const precise = drafts.find(
      (draft) => draft.legs[0]?.quantity.toString() === '0.100000000000000001',
    );

    expect(precise).toBeDefined();
  });

  it('gives the two identical id-less rows distinct natural keys', async () => {
    const drafts = await collect(adapter.read('acme-exchange/trades.csv'));
    const identified = assignExternalIds(drafts, {
      sourceType: SourceType('acme_exchange_csv'),
      walletId: WalletId('01900000-0000-7000-8000-0000000000d1'),
    });

    // The fixture contains the same SOL buy twice in the same second, deliberately.
    expect(new Set(identified.map((entry) => entry.externalId)).size).toBe(drafts.length);
  });

  it('rejects a payload reference that climbs out of the store', async () => {
    await expect(collect(adapter.read('../../etc/passwd'))).rejects.toBeInstanceOf(ValidationError);
  });

  it('reports a missing payload as permanent rather than retryable', async () => {
    const error = await collect(adapter.read('acme-exchange/nope.csv')).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
  });
});

describe('the chain JSON adapter', () => {
  const adapter = new FakeChainJsonAdapter(store);

  it('reads transfers as deposits and withdrawals qualified by chain', async () => {
    const drafts = await collect(adapter.read('fake-chain/transfers.json'));

    expect(drafts).toHaveLength(4);
    expect(drafts[0]?.kind).toBe('deposit');
    expect(drafts[0]?.legs[0]?.asset).toStrictEqual({ symbol: 'ETH', chain: 'ethereum' });
    expect(drafts[1]?.kind).toBe('withdrawal');
  });

  it('builds its natural key from the transaction hash and the log index', async () => {
    const drafts = await collect(adapter.read('fake-chain/transfers.json'));
    const sameTx = drafts.filter((draft) => draft.sourceId?.startsWith('0xbb22'));

    // One on-chain transaction, two transfers: the hash alone would collapse them.
    expect(sameTx).toHaveLength(2);
    expect(new Set(sameTx.map((draft) => draft.sourceId)).size).toBe(2);
  });

  it('records gas as a fee leg on the transfer that paid it', async () => {
    const drafts = await collect(adapter.read('fake-chain/transfers.json'));
    const withGas = drafts.find((draft) => draft.legs.some((leg) => leg.direction === 'fee'));

    expect(withGas?.legs.at(-1)?.quantity.toString()).toBe('0.001234567890123456');
  });

  it('rejects a payload that does not match the schema', async () => {
    await expect(collect(adapter.read('acme-exchange/trades.csv'))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
