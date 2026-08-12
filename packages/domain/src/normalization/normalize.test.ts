import { describe, expect, it } from 'vitest';

import { UnknownAssetError } from '../shared/errors.js';
import { ImportId } from '../shared/ids.js';
import {
  TEST_ASSET_IDS,
  TEST_SOURCE_TYPE,
  TEST_WALLET_ID,
  depositDraft,
  leg,
  sequentialTransactionIds,
  tradeDraft,
} from '../testing/builders.js';
import { normalizeImport } from './normalize.js';
import type { Transaction } from '../transaction/transaction.js';

const IMPORT_ID = ImportId('01900000-0000-7000-8000-00000000f001');

const normalize = (
  drafts: Parameters<typeof normalizeImport>[0]['drafts'],
): readonly Transaction[] =>
  normalizeImport({
    drafts,
    walletId: TEST_WALLET_ID,
    sourceType: TEST_SOURCE_TYPE,
    importId: IMPORT_ID,
    assetIds: TEST_ASSET_IDS,
    newTransactionId: sequentialTransactionIds(),
  });

describe('normalizeImport', () => {
  it('turns a trade into one transaction with three legs', () => {
    const [transaction] = normalize([tradeDraft()]);

    expect(transaction?.kind).toBe('trade');
    expect(transaction?.entries.map((entry) => entry.direction)).toStrictEqual([
      'in',
      'out',
      'fee',
    ]);
    expect(transaction?.entries.map((entry) => entry.entryIndex)).toStrictEqual([0, 1, 2]);
    expect(transaction?.entries[1]?.quantity.toString()).toBe('1200');
  });

  it('is deterministic: the same payload normalizes to exactly the same output', () => {
    const payload = [tradeDraft(), depositDraft(), tradeDraft()];

    const first = normalize(payload);
    const second = normalize(payload);

    // Deep equality across the whole result, not just the keys: identifiers, ordering, quantities
    // and entry indexes all have to match, because a retry re-runs this and must converge (FR-5).
    expect(JSON.stringify(second)).toStrictEqual(JSON.stringify(first));
  });

  it('resolves asset references to registry identifiers', () => {
    const [transaction] = normalize([depositDraft()]);
    expect(transaction?.entries[0]?.assetId).toBe(TEST_ASSET_IDS.get('BTC@-'));
  });

  it('refuses a payload naming an asset the registry does not know', () => {
    expect(() => normalize([depositDraft({ legs: [leg('in', 'SCAMCOIN', '1')] })])).toThrow(
      UnknownAssetError,
    );
  });

  it('stamps every transaction with the import that produced it', () => {
    const transactions = normalize([tradeDraft(), depositDraft()]);
    expect(transactions.every((transaction) => transaction.importId === IMPORT_ID)).toBe(true);
  });
});
