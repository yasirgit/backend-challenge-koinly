import { isRetryable } from '@app/application';

import { MalformedMessageError } from './envelope.js';

export type RetryDecision =
  | { readonly action: 'retry'; readonly nextAttempt: number }
  | { readonly action: 'dead-letter'; readonly reason: DeadLetterReason };

export type DeadLetterReason = 'malformed' | 'permanent-failure' | 'attempts-exhausted';

export interface RetryPolicyInput {
  readonly error: unknown;
  /** Which attempt just failed, counting from one. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * What to do with a message whose handler threw. Extracted from the consumer because it is the part
 * worth testing, and it is pure.
 *
 * The attempt count comes from an explicit message header rather than RabbitMQ's `x-death`, which
 * is easy to misread once a message has been dead-lettered through more than one queue.
 */
export const decideRetry = (input: RetryPolicyInput): RetryDecision => {
  if (input.error instanceof MalformedMessageError) {
    // Nothing about a redelivery will make an unparseable message parse.
    return { action: 'dead-letter', reason: 'malformed' };
  }

  if (!isRetryable(input.error)) {
    return { action: 'dead-letter', reason: 'permanent-failure' };
  }

  if (input.attempt >= input.maxAttempts) {
    return { action: 'dead-letter', reason: 'attempts-exhausted' };
  }

  return { action: 'retry', nextAttempt: input.attempt + 1 };
};
