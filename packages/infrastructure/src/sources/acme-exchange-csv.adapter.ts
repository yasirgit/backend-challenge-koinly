import { ValidationError, type SourceAdapter } from '@app/application';
import {
  AssetRef,
  Decimal,
  SourceType,
  type TransactionDraft,
  type TransactionDraftLeg,
} from '@app/domain';
import { parse } from 'csv-parse';

import { toPayloadError, type FixturePayloadStore } from './payload-store.js';

export const ACME_EXCHANGE_CSV = SourceType('acme_exchange_csv');

/**
 * A centralized-exchange trade export: one row per fill, base and quote on the same line, fee in
 * whichever currency the exchange felt like charging.
 *
 * Two things this fixture deliberately exercises. Some rows have the exchange's own trade id and
 * some do not, so both external-id strategies are on the happy path rather than one being
 * theoretical. And the id-less rows include a genuine duplicate — same pair, same amounts, same
 * second — which is what a trading bot produces and what a naive content hash would silently
 * collapse into one row.
 */
export class AcmeExchangeCsvAdapter implements SourceAdapter {
  readonly sourceType = ACME_EXCHANGE_CSV;

  constructor(private readonly store: FixturePayloadStore) {}

  async *read(payloadRef: string): AsyncIterable<TransactionDraft> {
    const source = this.store.openStream(payloadRef);
    const parser = parse({
      columns: true,
      trim: true,
      skip_empty_lines: true,
      // Streaming rather than buffering: an exchange export is routinely hundreds of thousands of
      // rows, and the point of the chunked write path is that we never hold them all.
      bom: true,
    });

    // `pipe` does not forward errors downstream. Without this, a missing file raises an unhandled
    // exception on the source stream while the parser's iterator waits for data that will never
    // arrive — the worker hangs instead of failing, which is the worse of the two outcomes.
    source.on('error', (error: Error) => parser.destroy(error));
    source.pipe(parser);

    let rowNumber = 1;
    try {
      for await (const row of parser as AsyncIterable<Record<string, string>>) {
        rowNumber += 1;
        yield toDraft(row, rowNumber);
      }
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw toPayloadError(error, payloadRef);
    }
  }
}

const required = (row: Record<string, string>, column: string, rowNumber: number): string => {
  const value = row[column];
  if (value === undefined || value.trim().length === 0) {
    throw new ValidationError(`Row ${String(rowNumber)} is missing ${column}`, {
      column,
      row: rowNumber,
    });
  }
  return value.trim();
};

const parseInstant = (value: string, rowNumber: number): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Row ${String(rowNumber)} has an unparseable timestamp`, {
      value,
      row: rowNumber,
    });
  }
  return parsed;
};

const toDraft = (row: Record<string, string>, rowNumber: number): TransactionDraft => {
  const side = required(row, 'side', rowNumber).toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    throw new ValidationError(`Row ${String(rowNumber)} has an unsupported side`, {
      side,
      row: rowNumber,
    });
  }

  const base = AssetRef(required(row, 'base_asset', rowNumber));
  const quote = AssetRef(required(row, 'quote_asset', rowNumber));
  const baseAmount = Decimal.from(required(row, 'base_amount', rowNumber));
  const quoteAmount = Decimal.from(required(row, 'quote_amount', rowNumber));

  const legs: TransactionDraftLeg[] =
    side === 'buy'
      ? [
          { direction: 'in', asset: base, quantity: baseAmount },
          { direction: 'out', asset: quote, quantity: quoteAmount },
        ]
      : [
          { direction: 'out', asset: base, quantity: baseAmount },
          { direction: 'in', asset: quote, quantity: quoteAmount },
        ];

  const feeAmount = row['fee_amount']?.trim() ?? '';
  const feeAsset = row['fee_asset']?.trim() ?? '';
  if (feeAmount.length > 0 && feeAsset.length > 0) {
    const quantity = Decimal.from(feeAmount);
    // A zero fee is not a fee. Recording it as one would violate the positive-quantity invariant
    // and add a meaningless leg to every row of a zero-fee export.
    if (quantity.isPositive()) {
      legs.push({ direction: 'fee', asset: AssetRef(feeAsset), quantity });
    }
  }

  const tradeId = row['trade_id']?.trim() ?? '';

  return {
    // Empty rather than absent is how a real export marks "no id for this fill", and it must not
    // become the string "undefined" in a natural key.
    sourceId: tradeId.length > 0 ? tradeId : null,
    kind: 'trade',
    occurredAt: parseInstant(required(row, 'executed_at', rowNumber), rowNumber),
    legs,
  };
};
