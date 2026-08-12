import type { SourceType, TransactionDraft } from '@app/domain';

/**
 * The integration seam. Everything a new exchange or chain needs to implement is here: locate the
 * payload, parse it, and describe what happened in domain terms.
 *
 * Note what is *not* in this interface. There is no shared "source record" type that every
 * integration has to squeeze its data into — that kind of lowest-common-denominator shape
 * accumulates `memo`, `txHash`, `orderId` and `blockNumber` until it means nothing. Parsing is
 * source knowledge and stays in the adapter; what crosses the boundary is already a deposit or a
 * trade with legs.
 */
export interface SourceAdapter {
  readonly sourceType: SourceType;

  /**
   * Streams the payload. An `AsyncIterable` rather than an array because an exchange export can be
   * hundreds of thousands of rows, and holding all of them in memory to insert them in one
   * transaction is how an import takes a service down.
   */
  read: (payloadRef: string) => AsyncIterable<TransactionDraft>;
}

export interface SourceRegistry {
  get: (sourceType: SourceType) => SourceAdapter | null;
  list: () => readonly SourceType[];
}
