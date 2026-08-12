import { assetRefKey } from '../asset/asset.js';
import { UnknownAssetError } from '../shared/errors.js';
import type { AssetId, ImportId, SourceType, TransactionId, WalletId } from '../shared/ids.js';
import { createTransaction, type Transaction } from '../transaction/transaction.js';
import type { TransactionDraft } from '../transaction/transaction-draft.js';
import { assignExternalIds, createExternalIdAssigner, type IdentifiedDraft } from './external-id.js';

export interface NormalizationContext {
  readonly walletId: WalletId;
  readonly sourceType: SourceType;
  readonly importId: ImportId;
  /**
   * Identifier supply. Injected rather than called directly so normalization is deterministic
   * given its arguments, which is what makes the determinism test meaningful (see ADR-0009).
   */
  readonly newTransactionId: () => TransactionId;
}

/**
 * Resolved assets, keyed by `assetRefKey`. Passed as data rather than as a lookup service so this
 * stays pure: resolution is I/O and belongs to the use case.
 */
export type ResolvedAssets = ReadonlyMap<string, AssetId>;

const toTransaction = (
  identified: IdentifiedDraft,
  context: NormalizationContext,
  assetIds: ResolvedAssets,
): Transaction =>
  createTransaction({
    id: context.newTransactionId(),
    walletId: context.walletId,
    importId: context.importId,
    externalId: identified.externalId,
    externalIdKind: identified.externalIdKind,
    kind: identified.draft.kind,
    occurredAt: identified.draft.occurredAt,
    sourceType: context.sourceType,
    entries: identified.draft.legs.map((leg) => {
      const key = assetRefKey(leg.asset);
      const assetId = assetIds.get(key);
      if (assetId === undefined) {
        throw new UnknownAssetError(`Asset ${key} is not in the registry`, {
          asset: key,
          externalId: identified.externalId,
        });
      }
      return { direction: leg.direction, assetId, quantity: leg.quantity };
    }),
  });

export interface ImportNormalizer {
  /** Normalizes one chunk, carrying occurrence ordinals over from previous chunks. */
  normalize: (drafts: readonly TransactionDraft[], assetIds: ResolvedAssets) => readonly Transaction[];
}

/**
 * Normalization for a payload that is processed in chunks.
 *
 * Keys depend on how many times the same content has already been seen in this payload, so the
 * assigner is created once per import and reused for every chunk. Chunking is an execution detail
 * and must not change the output.
 */
export const createImportNormalizer = (context: NormalizationContext): ImportNormalizer => {
  const assign = createExternalIdAssigner({
    sourceType: context.sourceType,
    walletId: context.walletId,
  });

  return {
    normalize: (drafts, assetIds) =>
      drafts.map((draft) => toTransaction(assign(draft), context, assetIds)),
  };
};

export interface NormalizeImportInput extends NormalizationContext {
  readonly drafts: readonly TransactionDraft[];
  readonly assetIds: ResolvedAssets;
}

/**
 * Whole-payload normalization. Pure: same input, same output, every time — which is the property
 * the idempotency story rests on, because a retry only converges if normalization is reproducible.
 */
export const normalizeImport = (input: NormalizeImportInput): readonly Transaction[] => {
  const identified = assignExternalIds(input.drafts, {
    sourceType: input.sourceType,
    walletId: input.walletId,
  });
  return identified.map((draft) => toTransaction(draft, input, input.assetIds));
};
