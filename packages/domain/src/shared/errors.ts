/**
 * Domain errors describe a rule that was broken, not a thing that went wrong. Everything raised
 * here is by definition permanent: retrying with the same input will break the same rule, so the
 * worker classifies these as non-retryable (see the error taxonomy in @app/application).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** A value could not be interpreted at all: malformed identifier, unparseable amount. */
export class InvalidValueError extends DomainError {
  readonly code = 'INVALID_VALUE';
}

/** A monetary value was well-formed but outside what the system can store exactly. */
export class AmountOutOfRangeError extends DomainError {
  readonly code = 'AMOUNT_OUT_OF_RANGE';
}

/** An aggregate would have been constructed in a state its invariants forbid. */
export class InvariantViolationError extends DomainError {
  readonly code = 'INVARIANT_VIOLATION';
}

/**
 * A payload referred to an asset that is not in the registry. Deliberately an error rather than an
 * auto-created asset: a tax system that quietly invents assets is worse than one that refuses the
 * row and says which symbol it did not recognize (see assumption A6).
 */
export class UnknownAssetError extends DomainError {
  readonly code = 'UNKNOWN_ASSET';
}
