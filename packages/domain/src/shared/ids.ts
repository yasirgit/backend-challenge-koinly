import type { Branded } from './branded.js';
import { InvalidValueError } from './errors.js';

export type UserId = Branded<string, 'UserId'>;
export type WalletId = Branded<string, 'WalletId'>;
export type AssetId = Branded<string, 'AssetId'>;
export type ImportId = Branded<string, 'ImportId'>;
export type TransactionId = Branded<string, 'TransactionId'>;

/**
 * A source slug such as `acme_exchange_csv`. Deliberately not a union of known sources: adding an
 * exchange must not require touching the domain layer (see the "where does my code go?" table in
 * ARCHITECTURE.md).
 */
export type SourceType = Branded<string, 'SourceType'>;

/**
 * The natural key that survives a re-import. Either the source's own identifier or a hash we
 * derive; `ExternalIdKind` records which, because the two have very different failure modes.
 */
export type ExternalId = Branded<string, 'ExternalId'>;
export type ExternalIdKind = 'source' | 'derived';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

const parseUuid = <T extends string>(value: string, label: string): T => {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidValueError(`${label} must be a UUID`, { label, value });
  }
  return value.toLowerCase() as T;
};

export const UserId = (value: string): UserId => parseUuid<UserId>(value, 'UserId');
export const WalletId = (value: string): WalletId => parseUuid<WalletId>(value, 'WalletId');
export const AssetId = (value: string): AssetId => parseUuid<AssetId>(value, 'AssetId');
export const ImportId = (value: string): ImportId => parseUuid<ImportId>(value, 'ImportId');
export const TransactionId = (value: string): TransactionId =>
  parseUuid<TransactionId>(value, 'TransactionId');

export const SourceType = (value: string): SourceType => {
  if (!SOURCE_TYPE_PATTERN.test(value)) {
    throw new InvalidValueError(
      'SourceType must be a lower_snake_case slug of 3 to 64 characters',
      { value },
    );
  }
  return value as SourceType;
};

export const ExternalId = (value: string): ExternalId => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 255) {
    throw new InvalidValueError('ExternalId must be between 1 and 255 characters', { value });
  }
  return trimmed as ExternalId;
};
