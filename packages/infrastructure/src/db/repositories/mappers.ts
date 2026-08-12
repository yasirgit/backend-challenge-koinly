import {
  Decimal,
  ExternalId,
  ImportId,
  SourceType,
  TransactionId,
  UserId,
  WalletId,
  type ImportRecord,
  type Transaction,
  type TransactionEntry,
  type TransactionKind,
  type Wallet,
} from '@app/domain';
import type { Selectable } from 'kysely';

import type {
  ImportsTable,
  TransactionEntriesTable,
  TransactionsTable,
  WalletsTable,
} from '../schema.js';

/**
 * The one place where database vocabulary meets domain vocabulary.
 *
 * Explicit rather than automatic: a `CamelCasePlugin` would make this file disappear, and with it
 * the only checkpoint where a column becomes a typed, validated domain value. Every branded
 * identifier is re-parsed here, so a corrupt row fails at the boundary instead of three layers in.
 */

export const toWallet = (row: Selectable<WalletsTable>): Wallet => ({
  id: WalletId(row.id),
  userId: UserId(row.user_id),
  sourceType: SourceType(row.source_type),
  sourceAccountRef: row.source_account_ref,
  label: row.label,
});

export const toImportRecord = (row: Selectable<ImportsTable>): ImportRecord => ({
  id: ImportId(row.id),
  userId: UserId(row.user_id),
  walletId: WalletId(row.wallet_id),
  sourceType: SourceType(row.source_type),
  payloadRef: row.payload_ref,
  idempotencyKey: row.idempotency_key,
  requestFingerprint: row.request_fingerprint,
  status: row.status,
  attempts: row.attempts,
  counts:
    row.rows_total === null
      ? null
      : {
          total: row.rows_total,
          imported: row.rows_imported ?? 0,
          skipped: row.rows_skipped ?? 0,
        },
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export const toTransaction = (
  row: Selectable<TransactionsTable>,
  entryRows: readonly Selectable<TransactionEntriesTable>[],
): Transaction => ({
  id: TransactionId(row.id),
  walletId: WalletId(row.wallet_id),
  importId: row.import_id === null ? null : ImportId(row.import_id),
  externalId: ExternalId(row.external_id),
  externalIdKind: row.external_id_kind,
  kind: row.kind as TransactionKind,
  occurredAt: row.occurred_at,
  sourceType: SourceType(row.source_type),
  entries: entryRows
    .slice()
    .sort((left, right) => left.entry_index - right.entry_index)
    .map(
      (entry): TransactionEntry => ({
        entryIndex: entry.entry_index,
        direction: entry.direction,
        assetId: entry.asset_id as TransactionEntry['assetId'],
        // The driver hands back a string and it stays a string all the way into the value object.
        quantity: Decimal.from(entry.quantity),
      }),
    ),
});
