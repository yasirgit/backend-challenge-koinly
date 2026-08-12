import type { Decimal } from '../money/decimal.js';
import { InvariantViolationError } from '../shared/errors.js';
import type {
  AssetId,
  ExternalId,
  ExternalIdKind,
  ImportId,
  SourceType,
  TransactionId,
  WalletId,
} from '../shared/ids.js';

/**
 * What kind of economic event this is. Deliberately coarse: the tax treatment of a `trade` depends
 * on rules that live nowhere in this skeleton, so the model only has to be able to *represent* the
 * event faithfully, not classify it.
 */
export const TRANSACTION_KINDS = [
  'deposit',
  'withdrawal',
  'trade',
  'fee',
  'transfer',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * Direction of a single asset movement. Quantities are always positive and the sign lives here, so
 * a fee is a fee rather than a negative amount somebody forgets to subtract (see ADR-0005).
 */
export const ENTRY_DIRECTIONS = ['in', 'out', 'fee'] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export interface TransactionEntry {
  readonly entryIndex: number;
  readonly direction: EntryDirection;
  readonly assetId: AssetId;
  readonly quantity: Decimal;
}

export interface Transaction {
  readonly id: TransactionId;
  readonly walletId: WalletId;
  readonly importId: ImportId | null;
  readonly externalId: ExternalId;
  readonly externalIdKind: ExternalIdKind;
  readonly kind: TransactionKind;
  /** When the event happened according to the source. Distinct from when we learned about it. */
  readonly occurredAt: Date;
  readonly sourceType: SourceType;
  readonly entries: readonly TransactionEntry[];
}

export interface CreateTransactionProps extends Omit<Transaction, 'entries'> {
  readonly entries: readonly Omit<TransactionEntry, 'entryIndex'>[];
}

const countByDirection = (
  entries: readonly Omit<TransactionEntry, 'entryIndex'>[],
  direction: EntryDirection,
): number => entries.filter((entry) => entry.direction === direction).length;

/**
 * The invariants live here rather than in the database because they are business rules, not storage
 * rules: a trade with no incoming leg is not a trade, whatever the column constraints allow.
 */
export const createTransaction = (props: CreateTransactionProps): Transaction => {
  if (props.entries.length === 0) {
    throw new InvariantViolationError('A transaction must have at least one entry', {
      externalId: props.externalId,
    });
  }

  for (const entry of props.entries) {
    if (!entry.quantity.isPositive()) {
      throw new InvariantViolationError(
        'Entry quantities must be positive; direction carries the sign',
        { externalId: props.externalId, quantity: entry.quantity.toString() },
      );
    }
  }

  if (Number.isNaN(props.occurredAt.getTime())) {
    throw new InvariantViolationError('Transaction occurredAt is not a valid instant', {
      externalId: props.externalId,
    });
  }

  const incoming = countByDirection(props.entries, 'in');
  const outgoing = countByDirection(props.entries, 'out');

  switch (props.kind) {
    case 'trade':
      if (incoming < 1 || outgoing < 1) {
        throw new InvariantViolationError(
          'A trade must have at least one incoming and one outgoing entry',
          { externalId: props.externalId, incoming, outgoing },
        );
      }
      break;
    case 'deposit':
      if (incoming < 1 || outgoing > 0) {
        throw new InvariantViolationError('A deposit must have incoming entries and no outgoing', {
          externalId: props.externalId,
          incoming,
          outgoing,
        });
      }
      break;
    case 'withdrawal':
    case 'transfer':
      if (outgoing < 1) {
        throw new InvariantViolationError(
          `A ${props.kind} must have at least one outgoing entry`,
          { externalId: props.externalId, outgoing },
        );
      }
      break;
    case 'fee':
      if (props.entries.length !== 1 || props.entries[0]?.direction !== 'fee') {
        throw new InvariantViolationError('A standalone fee must have exactly one fee entry', {
          externalId: props.externalId,
        });
      }
      break;
  }

  return {
    ...props,
    entries: props.entries.map((entry, entryIndex) => ({ ...entry, entryIndex })),
  };
};
