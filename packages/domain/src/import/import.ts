import { InvariantViolationError } from '../shared/errors.js';
import type { ImportId, SourceType, UserId, WalletId } from '../shared/ids.js';

/**
 * One attempt to ingest one payload into one wallet.
 *
 * The status is the pipeline's memory. It is deliberately *not* a lock — concurrency is excluded by
 * an advisory lock in the repository, because RabbitMQ redelivers the instant a channel drops,
 * long before any lease on a status column would expire (see ADR-0007).
 */
export const IMPORT_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface ImportCounts {
  readonly total: number;
  /** Rows that resulted in a new transaction on this attempt. */
  readonly imported: number;
  /** Rows already present, which is the normal outcome of a replay rather than a problem. */
  readonly skipped: number;
}

export interface ImportFailure {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface ImportRecord {
  readonly id: ImportId;
  readonly userId: UserId;
  readonly walletId: WalletId;
  readonly sourceType: SourceType;
  /** Where the bytes are, not the bytes themselves (see ADR-0010). */
  readonly payloadRef: string;
  readonly idempotencyKey: string;
  /** Hash of the request that created this import, so a reused key with a changed body is a conflict. */
  readonly requestFingerprint: string;
  readonly status: ImportStatus;
  readonly attempts: number;
  readonly counts: ImportCounts | null;
  readonly error: ImportFailure | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface CreateImportProps {
  readonly id: ImportId;
  readonly userId: UserId;
  readonly walletId: WalletId;
  readonly sourceType: SourceType;
  readonly payloadRef: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly createdAt: Date;
}

export const createImport = (props: CreateImportProps): ImportRecord => {
  if (props.payloadRef.trim().length === 0) {
    throw new InvariantViolationError('An import must reference a payload', { id: props.id });
  }
  if (props.idempotencyKey.trim().length === 0) {
    throw new InvariantViolationError('An import must carry an idempotency key', { id: props.id });
  }

  return {
    ...props,
    payloadRef: props.payloadRef.trim(),
    status: 'pending',
    attempts: 0,
    counts: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
};

export const isTerminal = (status: ImportStatus): boolean =>
  status === 'completed' || status === 'failed';

/**
 * Whether this import still has work to do.
 *
 * `processing` counts as processable: a worker that crashed mid-import leaves the row in that
 * state, and the replacement worker must be able to take over. Doing the work again is safe because
 * every write is idempotent, which is precisely why the status does not need to be a lock.
 */
export const isProcessable = (record: ImportRecord): boolean => record.status !== 'completed';
