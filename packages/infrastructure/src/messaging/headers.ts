/**
 * The attempt counter is ours rather than RabbitMQ's `x-death`, which counts dead-letterings per
 * queue and becomes ambiguous the moment a message passes through more than one. An explicit
 * header is one number with one meaning.
 */
export const ATTEMPT_HEADER = 'x-import-attempt';
export const CORRELATION_HEADER = 'x-correlation-id';
export const DEAD_LETTER_REASON_HEADER = 'x-dead-letter-reason';

export const readAttempt = (headers: Record<string, unknown> | undefined): number => {
  const raw = headers?.[ATTEMPT_HEADER];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  // A message without the header predates it or came from somewhere else. Counting it as the first
  // attempt is the forgiving choice, and the attempt ceiling still bounds the damage.
  return 1;
};
