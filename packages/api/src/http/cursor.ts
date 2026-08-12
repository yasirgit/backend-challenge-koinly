import { ValidationError, type TransactionCursor } from '@app/application';
import { ExternalId } from '@app/domain';

/**
 * Turns a keyset position into an opaque token and back.
 *
 * Opaque on purpose: a client that learns the cursor is `(occurredAt, externalId)` will eventually
 * construct one, and then the ordering columns cannot change without breaking them. Base64url
 * because the token goes in a query string.
 */
export const encodeCursor = (cursor: TransactionCursor): string =>
  Buffer.from(
    JSON.stringify({ t: cursor.occurredAt.toISOString(), e: cursor.externalId }),
    'utf8',
  ).toString('base64url');

export const decodeCursor = (token: string): TransactionCursor => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('cursor is not a valid pagination token');
  }

  const candidate = parsed as { t?: unknown; e?: unknown };
  if (typeof candidate.t !== 'string' || typeof candidate.e !== 'string') {
    throw new ValidationError('cursor is not a valid pagination token');
  }

  const occurredAt = new Date(candidate.t);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ValidationError('cursor is not a valid pagination token');
  }

  return { occurredAt, externalId: ExternalId(candidate.e) };
};
