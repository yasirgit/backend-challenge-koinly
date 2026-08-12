import type { ImportId, SourceType, WalletId } from '@app/domain';

/**
 * The job that crosses the intake-to-worker seam.
 *
 * Small and fixed: an identifier and a pointer, never the payload (see ADR-0010). The import row is
 * the source of truth, so a redelivered message costs nothing to re-read.
 */
export interface ImportRequestedJob {
  readonly importId: ImportId;
  readonly walletId: WalletId;
  readonly sourceType: SourceType;
  readonly payloadRef: string;
  /** Follows the work from the HTTP request into the worker's logs. */
  readonly correlationId: string;
}

export interface ImportJobPublisher {
  /**
   * Resolves once the broker has confirmed the message. A rejected promise means the job is *not*
   * queued, which the intake use case surfaces rather than swallowing (see ADR-0011).
   */
  publish: (job: ImportRequestedJob) => Promise<void>;
}
