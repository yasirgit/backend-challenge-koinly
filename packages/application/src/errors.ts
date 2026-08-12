import { DomainError } from '@app/domain';

/**
 * The error taxonomy the worker's retry decision is built on.
 *
 * The important line is transient versus permanent. A transient failure is worth retrying because
 * the same input may succeed later; a permanent one will fail identically forever, so retrying it
 * only delays the moment somebody finds out. Getting this wrong in either direction is expensive:
 * retrying a malformed payload burns the queue, and permanently failing a batch because the
 * database blipped loses work that was never wrong.
 */
export abstract class ApplicationError extends Error {
  abstract readonly code: string;
  /** Whether re-running this operation with the same input could plausibly succeed. */
  abstract readonly retryable: boolean;

  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class NotFoundError extends ApplicationError {
  readonly code = 'NOT_FOUND';
  readonly retryable = false;
}

/** A request contradicts something that already exists, such as a reused idempotency key. */
export class ConflictError extends ApplicationError {
  readonly code = 'CONFLICT';
  readonly retryable = false;
}

/** The input could not be accepted. Re-sending it unchanged will fail the same way. */
export class ValidationError extends ApplicationError {
  readonly code = 'VALIDATION_FAILED';
  readonly retryable = false;
}

/** A dependency was unavailable or timed out. The input was fine; the world was not. */
export class DependencyUnavailableError extends ApplicationError {
  readonly code = 'DEPENDENCY_UNAVAILABLE';
  readonly retryable = true;
}

/** Another worker holds the lock for this unit of work. Come back later. */
export class ConcurrencyError extends ApplicationError {
  readonly code = 'CONCURRENT_EXECUTION';
  readonly retryable = true;
}

/**
 * The import was persisted but its job could not be queued. Distinguished from a generic
 * dependency failure because the caller needs to be told something specific: the import exists, it
 * has an id, and nothing is working on it until the request is retried (see ADR-0011).
 */
export class JobPublicationError extends ApplicationError {
  readonly code = 'JOB_NOT_QUEUED';
  readonly retryable = true;
}

/**
 * The default for anything unrecognized is *retryable*.
 *
 * That is the safe direction. An unknown error is far more often a dependency having a bad minute
 * than a genuine logic bug, and the cost of a wrong guess is asymmetric: an extra retry costs a few
 * seconds, while permanently failing a valid import costs somebody their tax return. Attempts are
 * bounded anyway, so a genuinely permanent unknown error still ends up in the dead-letter queue —
 * just a few attempts later, with the evidence intact.
 */
export const isRetryable = (error: unknown): boolean => {
  if (error instanceof ApplicationError) {
    return error.retryable;
  }
  // Domain errors are broken rules: the same input breaks the same rule forever.
  if (error instanceof DomainError) {
    return false;
  }
  return true;
};

export const describeError = (
  error: unknown,
): { code: string; message: string; details?: Record<string, unknown> } => {
  if (error instanceof ApplicationError || error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      details: { ...error.details },
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
};
