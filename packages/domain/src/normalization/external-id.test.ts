import { describe, expect, it } from 'vitest';

import { Decimal } from '../money/decimal.js';
import { TEST_SOURCE_TYPE, TEST_WALLET_ID, leg, tradeDraft } from '../testing/builders.js';
import { assignExternalIds, deriveExternalId } from './external-id.js';

const context = { sourceType: TEST_SOURCE_TYPE, walletId: TEST_WALLET_ID };

describe('external id derivation', () => {
  it('is stable across runs for the same content', () => {
    const first = deriveExternalId(tradeDraft(), context, 0);
    const second = deriveExternalId(tradeDraft(), context, 0);
    expect(first).toBe(second);
  });

  it('does not depend on the order the legs arrive in', () => {
    const ordered = tradeDraft();
    const shuffled = tradeDraft({ legs: [...ordered.legs].reverse() });
    expect(deriveExternalId(shuffled, context, 0)).toBe(deriveExternalId(ordered, context, 0));
  });

  it('does not depend on how a quantity was written', () => {
    const canonical = tradeDraft({ legs: [leg('in', 'ETH', '0.5'), leg('out', 'USDC', '1200')] });
    const padded = tradeDraft({
      legs: [leg('in', 'eth', '0.500'), leg('out', 'USDC', '1200.00')],
    });
    expect(deriveExternalId(padded, context, 0)).toBe(deriveExternalId(canonical, context, 0));
  });

  it('separates events that differ in any material field', () => {
    const base = deriveExternalId(tradeDraft(), context, 0);
    const laterTime = deriveExternalId(
      tradeDraft({ occurredAt: new Date('2024-03-01T10:00:01.000Z') }),
      context,
      0,
    );
    const differentQuantity = deriveExternalId(
      tradeDraft({ legs: [leg('in', 'ETH', '0.6'), leg('out', 'USDC', '1200')] }),
      context,
      0,
    );
    const otherWallet = deriveExternalId(
      tradeDraft(),
      { ...context, walletId: TEST_WALLET_ID.replace(/1$/, '2') as typeof TEST_WALLET_ID },
      0,
    );

    expect(new Set([base, laterTime, differentQuantity, otherWallet]).size).toBe(4);
  });

  it('carries the hash version in the key so the algorithm can change visibly', () => {
    expect(deriveExternalId(tradeDraft(), context, 0)).toMatch(/^v1:[0-9a-f]{64}$/);
  });
});

describe('assigning keys across a payload', () => {
  it('prefers the identifier the source gave us', () => {
    const [identified] = assignExternalIds([tradeDraft({ sourceId: 'trade-99' })], context);
    expect(identified?.externalId).toBe('trade-99');
    expect(identified?.externalIdKind).toBe('source');
  });

  it('keeps two genuinely identical rows apart', () => {
    // Same asset, same amounts, same second. A bot does this all day, and collapsing them into one
    // row would be silent data loss (FR-7).
    const identified = assignExternalIds([tradeDraft(), tradeDraft()], context);

    expect(identified).toHaveLength(2);
    expect(identified[0]?.externalId).not.toBe(identified[1]?.externalId);
    expect(identified.every((entry) => entry.externalIdKind === 'derived')).toBe(true);
  });

  it('assigns the same keys when the same payload is imported again', () => {
    const payload = [tradeDraft(), tradeDraft(), { ...tradeDraft(), legs: [leg('in', 'ETH', '1')] }];

    const first = assignExternalIds(payload, context).map((entry) => entry.externalId);
    const second = assignExternalIds(payload, context).map((entry) => entry.externalId);

    expect(second).toStrictEqual(first);
  });

  it('counts occurrences per content, not per payload', () => {
    const identified = assignExternalIds(
      [
        tradeDraft(),
        { ...tradeDraft(), legs: [leg('in', 'ETH', Decimal.from('1').toString())] },
        tradeDraft(),
      ],
      context,
    );

    // The two identical trades are occurrences 0 and 1 of their content; the odd one out is
    // occurrence 0 of its own, and its key must not be perturbed by the row between them.
    const standalone = assignExternalIds(
      [{ ...tradeDraft(), legs: [leg('in', 'ETH', '1')] }],
      context,
    );
    expect(identified[1]?.externalId).toBe(standalone[0]?.externalId);
  });
});
