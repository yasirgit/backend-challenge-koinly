import { AssetRef } from '../asset/asset.js';
import { Decimal } from '../money/decimal.js';
import { AssetId, SourceType, TransactionId, WalletId } from '../shared/ids.js';
import type { TransactionDraft, TransactionDraftLeg } from '../transaction/transaction-draft.js';

/**
 * Deterministic test data. Every identifier is fixed, so a failing assertion prints a value that
 * means the same thing on the next run.
 */

export const TEST_WALLET_ID = WalletId('01900000-0000-7000-8000-000000000001');
export const TEST_SOURCE_TYPE = SourceType('acme_exchange_csv');
export const TEST_ASSET_IDS = new Map<string, AssetId>([
  ['ETH@-', AssetId('01900000-0000-7000-8000-0000000000e1')],
  ['USDC@-', AssetId('01900000-0000-7000-8000-0000000000c1')],
  ['BTC@-', AssetId('01900000-0000-7000-8000-0000000000b1')],
]);

/** A sequential identifier supply, so normalization output is stable across runs. */
export const sequentialTransactionIds = (): (() => TransactionId) => {
  let next = 0;
  return () => {
    next += 1;
    return TransactionId(`01900000-0000-7000-8000-${next.toString(16).padStart(12, '0')}`);
  };
};

export const leg = (
  direction: TransactionDraftLeg['direction'],
  symbol: string,
  quantity: string,
): TransactionDraftLeg => ({
  direction,
  asset: AssetRef(symbol),
  quantity: Decimal.from(quantity),
});

export const tradeDraft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  sourceId: null,
  kind: 'trade',
  occurredAt: new Date('2024-03-01T10:00:00.000Z'),
  legs: [leg('in', 'ETH', '0.5'), leg('out', 'USDC', '1200'), leg('fee', 'USDC', '1.2')],
  ...overrides,
});

export const depositDraft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  sourceId: null,
  kind: 'deposit',
  occurredAt: new Date('2024-02-01T08:30:00.000Z'),
  legs: [leg('in', 'BTC', '0.01')],
  ...overrides,
});
