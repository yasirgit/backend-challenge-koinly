import {
  ApplicationError,
  ConcurrencyError,
  ConflictError,
  DependencyUnavailableError,
  JobPublicationError,
  NotFoundError,
  ValidationError,
} from '@app/application';
import { AmountOutOfRangeError, DomainError } from '@app/domain';
import { ZodError } from 'zod';

export interface HttpErrorResponse {
  readonly status: number;
  readonly body: {
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    };
    readonly correlationId: string;
  };
}

/**
 * One place where an internal failure becomes a status code.
 *
 * Route handlers throw domain and application errors and never mention HTTP. Anything not
 * recognized here becomes a 500 with a generic message, because leaking an internal error string to
 * a client is how stack traces end up in support tickets — the detail goes to the logs instead.
 */
export const toHttpError = (error: unknown, correlationId: string): HttpErrorResponse => {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request is not valid',
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        correlationId,
      },
    };
  }

  if (error instanceof ApplicationError || error instanceof DomainError) {
    return {
      status: statusFor(error),
      body: {
        error: { code: error.code, message: error.message, details: { ...error.details } },
        correlationId,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      correlationId,
    },
  };
};

const statusFor = (error: ApplicationError | DomainError): number => {
  if (error instanceof NotFoundError) {
    return 404;
  }
  if (error instanceof ConflictError) {
    return 409;
  }
  if (error instanceof ConcurrencyError) {
    // The request was fine; the resource is busy. Worth retrying, hence 409 rather than 400.
    return 409;
  }
  if (error instanceof JobPublicationError) {
    // The import is durable but nothing is working on it. 502 rather than 500 because the failure
    // is upstream of us and the client's retry is the documented recovery (ADR-0011).
    return 502;
  }
  if (error instanceof DependencyUnavailableError) {
    return 503;
  }
  if (error instanceof ValidationError || error instanceof AmountOutOfRangeError) {
    return 400;
  }
  if (error instanceof DomainError) {
    // A broken business rule is a well-formed request the system cannot accept.
    return 422;
  }
  return 500;
};
