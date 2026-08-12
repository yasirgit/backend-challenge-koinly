import { ValidationError, type SourceAdapter } from '@app/application';
import {
  AssetRef,
  Decimal,
  SourceType,
  type TransactionDraft,
  type TransactionDraftLeg,
} from '@app/domain';
import { z } from 'zod';

import type { FixturePayloadStore } from './payload-store.js';

export const FAKE_CHAIN_JSON = SourceType('fake_chain_json');

/**
 * A chain indexer's transfer feed. Structurally nothing like the CSV: nested objects, a chain that
 * qualifies every asset, gas denominated separately from the value moved, and a natural key made
 * of two fields rather than one.
 *
 * The second adapter exists to prove the seam is real. With one integration you cannot tell an
 * abstraction from a rename, and the shapes here differ enough that any accidental coupling to the
 * CSV's assumptions would have shown up while writing it.
 */
const transferSchema = z.object({
  txHash: z.string().min(1),
  logIndex: z.number().int().nonnegative(),
  blockTime: z.string().datetime(),
  direction: z.enum(['in', 'out']),
  asset: z.object({
    symbol: z.string().min(1),
    contract: z.string().nullable().optional(),
  }),
  value: z.string().min(1),
  gasFee: z
    .object({
      symbol: z.string().min(1),
      value: z.string().min(1),
    })
    .nullable()
    .optional(),
});

const payloadSchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1),
  transfers: z.array(transferSchema),
});

export class FakeChainJsonAdapter implements SourceAdapter {
  readonly sourceType = FAKE_CHAIN_JSON;

  constructor(private readonly store: FixturePayloadStore) {}

  async *read(payloadRef: string): AsyncIterable<TransactionDraft> {
    const text = await this.store.readText(payloadRef);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ValidationError('Payload is not valid JSON', { payloadRef });
    }

    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError('Payload does not match the chain transfer schema', {
        payloadRef,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`),
      });
    }

    // Read whole rather than streamed, which is honest about the limitation: a JSON document has to
    // be parsed in full unless you bring a streaming parser. A real chain adapter would page an RPC
    // endpoint instead, which streams naturally — the interface already allows it.
    for (const transfer of parsed.data.transfers) {
      const asset = AssetRef(transfer.asset.symbol, parsed.data.chain);
      const legs: TransactionDraftLeg[] = [
        {
          direction: transfer.direction,
          asset,
          quantity: Decimal.from(transfer.value),
        },
      ];

      if (transfer.gasFee != null) {
        const quantity = Decimal.from(transfer.gasFee.value);
        if (quantity.isPositive()) {
          legs.push({
            direction: 'fee',
            asset: AssetRef(transfer.gasFee.symbol, parsed.data.chain),
            quantity,
          });
        }
      }

      yield {
        // Two fields make the key: one transaction can carry many transfers, so the hash alone
        // would not distinguish them.
        sourceId: `${transfer.txHash}:${String(transfer.logIndex)}`,
        kind: transfer.direction === 'in' ? 'deposit' : 'withdrawal',
        occurredAt: new Date(transfer.blockTime),
        legs,
      };
    }
  }
}
