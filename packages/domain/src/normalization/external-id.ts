import { createHash } from 'node:crypto';

import type { TransactionDraft, TransactionDraftLeg } from '../transaction/transaction-draft.js';
import { ExternalId, type ExternalIdKind, type SourceType, type WalletId } from '../shared/ids.js';

/**
 * Bumped when the canonical serialization below changes. It is part of the stored key, so a change
 * is visible in the data rather than silently producing a parallel universe of duplicates — and a
 * migration can tell old keys from new ones.
 */
export const EXTERNAL_ID_HASH_VERSION = 'v1';

const FIELD_SEPARATOR = '\u001f';

export interface ExternalIdContext {
  readonly sourceType: SourceType;
  readonly walletId: WalletId;
}

const canonicalLeg = (leg: TransactionDraftLeg): string =>
  [leg.direction, leg.asset.symbol, leg.asset.chain ?? '-', leg.quantity.toString()].join(':');

/**
 * The content that identifies an event, in a form that is stable across re-imports.
 *
 * Legs are sorted rather than taken in payload order, so a source that reorders the sides of a
 * trade does not produce a different key for the same event. Quantities go in through
 * `Decimal.toString`, whose canonical form makes `1.50` and `1.5` hash identically.
 */
const canonicalContent = (draft: TransactionDraft, context: ExternalIdContext): string =>
  [
    EXTERNAL_ID_HASH_VERSION,
    context.sourceType,
    context.walletId,
    draft.occurredAt.toISOString(),
    draft.kind,
    ...draft.legs.map(canonicalLeg).sort(),
  ].join(FIELD_SEPARATOR);

/**
 * @param ordinal Which occurrence of this exact content within the payload this is, counted from
 * zero. Without it, two genuinely distinct trades with identical fields in the same second — which
 * bots produce constantly — would hash to the same key and the second would be dropped as a
 * duplicate. That is data loss wearing idempotency's clothes.
 */
export const deriveExternalId = (
  draft: TransactionDraft,
  context: ExternalIdContext,
  ordinal: number,
): ExternalId => {
  const digest = createHash('sha256')
    .update(`${canonicalContent(draft, context)}${FIELD_SEPARATOR}#${String(ordinal)}`)
    .digest('hex');
  return ExternalId(`${EXTERNAL_ID_HASH_VERSION}:${digest}`);
};

export interface IdentifiedDraft {
  readonly draft: TransactionDraft;
  readonly externalId: ExternalId;
  readonly externalIdKind: ExternalIdKind;
}

export type ExternalIdAssigner = (draft: TransactionDraft) => IdentifiedDraft;

/**
 * Attaches natural keys to the drafts of one payload, one at a time.
 *
 * Stateful on purpose: occurrence ordinals are counted across the whole payload, so the assigner
 * has to outlive a single draft. A large import is persisted in chunks, and this is what keeps the
 * ordinals — and therefore the keys — identical to what a single-pass run would produce.
 */
export const createExternalIdAssigner = (context: ExternalIdContext): ExternalIdAssigner => {
  const occurrences = new Map<string, number>();

  return (draft) => {
    if (draft.sourceId !== null && draft.sourceId.trim().length > 0) {
      return { draft, externalId: ExternalId(draft.sourceId), externalIdKind: 'source' };
    }

    const content = canonicalContent(draft, context);
    const ordinal = occurrences.get(content) ?? 0;
    occurrences.set(content, ordinal + 1);

    return { draft, externalId: deriveExternalId(draft, context, ordinal), externalIdKind: 'derived' };
  };
};

/**
 * Whole-payload convenience over {@link createExternalIdAssigner}.
 *
 * Re-importing the same bytes produces the same keys and stays idempotent, while duplicates within
 * one payload each get their own key and both survive.
 */
export const assignExternalIds = (
  drafts: readonly TransactionDraft[],
  context: ExternalIdContext,
): readonly IdentifiedDraft[] => drafts.map(createExternalIdAssigner(context));
