import type { ImportRecord, Transaction, Wallet } from '@app/domain';

/**
 * Domain objects are not response bodies. Mapping them explicitly means adding a field to an
 * aggregate does not silently change the public API, and it is where the money rule is enforced at
 * the boundary: every quantity leaves as a string, never as a JSON number.
 */

export const walletResponse = (wallet: Wallet): Record<string, unknown> => ({
  id: wallet.id,
  userId: wallet.userId,
  sourceType: wallet.sourceType,
  sourceAccountRef: wallet.sourceAccountRef,
  label: wallet.label,
});

export const importResponse = (record: ImportRecord): Record<string, unknown> => ({
  id: record.id,
  walletId: record.walletId,
  sourceType: record.sourceType,
  payloadRef: record.payloadRef,
  status: record.status,
  attempts: record.attempts,
  // Per-attempt diagnostics, not idempotent values: a replay reports zero newly imported rows
  // because there was nothing new to import. Named so that is not a surprise.
  counts: record.counts,
  error: record.error,
  createdAt: record.createdAt.toISOString(),
  startedAt: record.startedAt?.toISOString() ?? null,
  finishedAt: record.finishedAt?.toISOString() ?? null,
});

export const transactionResponse = (transaction: Transaction): Record<string, unknown> => ({
  id: transaction.id,
  walletId: transaction.walletId,
  importId: transaction.importId,
  externalId: transaction.externalId,
  externalIdKind: transaction.externalIdKind,
  kind: transaction.kind,
  occurredAt: transaction.occurredAt.toISOString(),
  sourceType: transaction.sourceType,
  entries: transaction.entries.map((entry) => ({
    entryIndex: entry.entryIndex,
    direction: entry.direction,
    assetId: entry.assetId,
    quantity: entry.quantity.toString(),
  })),
});
