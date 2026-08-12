import { describe, expect, it } from 'vitest';

import { Decimal } from '../money/decimal.js';
import { InvariantViolationError } from '../shared/errors.js';
import { AssetId, ExternalId, SourceType, TransactionId, WalletId } from '../shared/ids.js';
import { createTransaction, type CreateTransactionProps } from './transaction.js';

const ASSET_ETH = AssetId('01900000-0000-7000-8000-0000000000e1');
const ASSET_USDC = AssetId('01900000-0000-7000-8000-0000000000c1');

const props = (overrides: Partial<CreateTransactionProps> = {}): CreateTransactionProps => ({
  id: TransactionId('01900000-0000-7000-8000-000000000101'),
  walletId: WalletId('01900000-0000-7000-8000-000000000001'),
  importId: null,
  externalId: ExternalId('trade-1'),
  externalIdKind: 'source',
  kind: 'trade',
  occurredAt: new Date('2024-03-01T10:00:00.000Z'),
  sourceType: SourceType('acme_exchange_csv'),
  entries: [
    { direction: 'in', assetId: ASSET_ETH, quantity: Decimal.from('0.5') },
    { direction: 'out', assetId: ASSET_USDC, quantity: Decimal.from('1200') },
  ],
  ...overrides,
});

describe('createTransaction', () => {
  it('numbers entries in the order they were given', () => {
    const transaction = createTransaction(props());
    expect(transaction.entries.map((entry) => entry.entryIndex)).toStrictEqual([0, 1]);
  });

  it('rejects a transaction with no entries', () => {
    expect(() => createTransaction(props({ entries: [] }))).toThrow(InvariantViolationError);
  });

  it('rejects a non-positive quantity, because direction carries the sign', () => {
    for (const quantity of ['0', '-1']) {
      expect(() =>
        createTransaction(
          props({
            entries: [{ direction: 'in', assetId: ASSET_ETH, quantity: Decimal.from(quantity) }],
            kind: 'deposit',
          }),
        ),
      ).toThrow(InvariantViolationError);
    }
  });

  it('rejects a trade that is missing a side', () => {
    expect(() =>
      createTransaction(
        props({ entries: [{ direction: 'in', assetId: ASSET_ETH, quantity: Decimal.from('1') }] }),
      ),
    ).toThrow(InvariantViolationError);
  });

  it('rejects a deposit that also moves value out', () => {
    expect(() =>
      createTransaction(
        props({
          kind: 'deposit',
          entries: [
            { direction: 'in', assetId: ASSET_ETH, quantity: Decimal.from('1') },
            { direction: 'out', assetId: ASSET_USDC, quantity: Decimal.from('1') },
          ],
        }),
      ),
    ).toThrow(InvariantViolationError);
  });

  it('accepts a trade with a fee leg', () => {
    const transaction = createTransaction(
      props({
        entries: [
          { direction: 'in', assetId: ASSET_ETH, quantity: Decimal.from('0.5') },
          { direction: 'out', assetId: ASSET_USDC, quantity: Decimal.from('1200') },
          { direction: 'fee', assetId: ASSET_USDC, quantity: Decimal.from('1.2') },
        ],
      }),
    );
    expect(transaction.entries).toHaveLength(3);
  });
});
