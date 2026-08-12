/**
 * The two dependencies that make code non-deterministic if taken ambiently. Both are ports so a
 * test can pin them, and an ESLint rule stops anyone reaching for `Date.now()` or `Math.random()`
 * in the domain or application layers instead (NFR-4).
 */

export interface Clock {
  now: () => Date;
}

export interface IdGenerator {
  /**
   * A fresh UUIDv7. Time-ordered, so primary keys keep index locality, and generated here rather
   * than by the database so an aggregate has identity before it is persisted (see ADR-0009).
   */
  newId: () => string;
}
