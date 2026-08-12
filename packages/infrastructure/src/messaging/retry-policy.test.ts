import { ConcurrencyError, ValidationError } from '@app/application';
import { UnknownAssetError } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { MalformedMessageError } from './envelope.js';
import { decideRetry } from './retry-policy.js';

const decide = (error: unknown, attempt = 1): ReturnType<typeof decideRetry> =>
  decideRetry({ error, attempt, maxAttempts: 3 });

describe('retry policy', () => {
  it('parks an unparseable message immediately', () => {
    expect(decide(new MalformedMessageError('body is not valid JSON'))).toStrictEqual({
      action: 'dead-letter',
      reason: 'malformed',
    });
  });

  it('parks a permanent failure without spending retries on it', () => {
    // A payload naming an asset we do not know will name it again on every redelivery.
    expect(decide(new UnknownAssetError('Asset SCAM@- is not in the registry')).action).toBe(
      'dead-letter',
    );
    expect(decide(new ValidationError('No adapter registered')).action).toBe('dead-letter');
  });

  it('retries a transient failure', () => {
    expect(decide(new ConcurrencyError('locked'))).toStrictEqual({
      action: 'retry',
      nextAttempt: 2,
    });
  });

  it('treats an unrecognized error as transient', () => {
    // The safe direction: an extra retry costs seconds, permanently failing a valid import costs
    // somebody their tax return. Attempts are bounded, so a genuinely broken message still parks.
    expect(decide(new Error('ECONNRESET')).action).toBe('retry');
  });

  it('parks a message once its attempts are spent', () => {
    expect(decide(new Error('ECONNRESET'), 3)).toStrictEqual({
      action: 'dead-letter',
      reason: 'attempts-exhausted',
    });
  });
});
