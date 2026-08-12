import type { AssetRef } from '../asset/asset.js';
import type { Decimal } from '../money/decimal.js';
import type { EntryDirection, TransactionKind } from './transaction.js';

export interface TransactionDraftLeg {
  readonly direction: EntryDirection;
  readonly asset: AssetRef;
  readonly quantity: Decimal;
}

/**
 * What a source adapter produces: an economic event described in domain terms, but without the
 * things only the domain may decide — the identity, the natural key, the resolved assets.
 *
 * This is not a lowest-common-denominator "source record" that every integration has to squeeze
 * into. Parsing a CSV row or an RPC response is source knowledge and stays in the adapter; what
 * crosses the boundary is already a deposit or a trade with legs. That split is what keeps the
 * interesting half — identity, ordinals, invariants — pure and testable without any I/O.
 */
export interface TransactionDraft {
  /**
   * The source's own stable identifier for this event, or null when it does not provide one.
   * Preferred over a derived key whenever it exists, because a derived key is only as stable as the
   * source's output format (see ADR-0007).
   */
  readonly sourceId: string | null;
  readonly kind: TransactionKind;
  readonly occurredAt: Date;
  readonly legs: readonly TransactionDraftLeg[];
}
