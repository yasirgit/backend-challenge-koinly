import type { Clock, IdGenerator } from '@app/application';
import { uuidv7 } from 'uuidv7';

/**
 * The two adapters that make the rest of the system deterministic by taking the non-determinism
 * out of it. This is the only module allowed to read a clock or generate randomness, which is
 * enforced by an ESLint rule everywhere else.
 */

export const systemClock: Clock = {
  now: () => new Date(),
};

export const uuidV7Generator: IdGenerator = {
  newId: () => uuidv7(),
};
