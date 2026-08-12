/**
 * The domain layer: entities, value objects and the rules that hold them together.
 *
 * Nothing in here may perform I/O, read configuration or look at a clock. Everything it needs is
 * passed in, which is what makes it testable in milliseconds and reproducible on a retry.
 */

export type { Branded } from './shared/branded.js';
export {
  AmountOutOfRangeError,
  DomainError,
  InvalidValueError,
  InvariantViolationError,
  UnknownAssetError,
} from './shared/errors.js';
export {
  AssetId,
  ExternalId,
  ImportId,
  SourceType,
  TransactionId,
  UserId,
  WalletId,
} from './shared/ids.js';
export type { ExternalIdKind } from './shared/ids.js';

export { Decimal } from './money/decimal.js';
export { AssetAmount } from './money/asset-amount.js';

export { AssetRef, assetKeyOf, assetRefKey } from './asset/asset.js';
export type { Asset } from './asset/asset.js';

export { IMPORT_STATUSES, createImport, isProcessable, isTerminal } from './import/import.js';
export type {
  CreateImportProps,
  ImportCounts,
  ImportFailure,
  ImportRecord,
  ImportStatus,
} from './import/import.js';

export { createWallet } from './wallet/wallet.js';
export type { CreateWalletProps, Wallet } from './wallet/wallet.js';

export {
  ENTRY_DIRECTIONS,
  TRANSACTION_KINDS,
  createTransaction,
} from './transaction/transaction.js';
export type {
  CreateTransactionProps,
  EntryDirection,
  Transaction,
  TransactionEntry,
  TransactionKind,
} from './transaction/transaction.js';
export type {
  TransactionDraft,
  TransactionDraftLeg,
} from './transaction/transaction-draft.js';

export {
  EXTERNAL_ID_HASH_VERSION,
  assignExternalIds,
  createExternalIdAssigner,
  deriveExternalId,
} from './normalization/external-id.js';
export type {
  ExternalIdAssigner,
  ExternalIdContext,
  IdentifiedDraft,
} from './normalization/external-id.js';
export { createImportNormalizer, normalizeImport } from './normalization/normalize.js';
export type {
  ImportNormalizer,
  NormalizationContext,
  NormalizeImportInput,
  ResolvedAssets,
} from './normalization/normalize.js';
