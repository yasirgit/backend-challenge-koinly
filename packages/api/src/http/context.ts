import { ValidationError } from '@app/application';
import { UserId } from '@app/domain';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyRequest } from 'fastify';

export const CORRELATION_HEADER = 'x-correlation-id';
export const USER_HEADER = 'x-user-id';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

const headerValue = (request: FastifyRequest, name: string): string | null => {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.trim().length === 0 ? null : value.trim();
};

/**
 * Accepts the caller's correlation identifier when there is one, mints one otherwise. Every log
 * line and the queue message carry it, so one import is greppable from the HTTP request through
 * the broker into the worker (NFR-7).
 *
 * Takes the raw request because Fastify assigns the request id before it has built its own request
 * object.
 */
export const correlationIdOf = (raw: { headers: IncomingHttpHeaders }): string => {
  const value = raw.headers[CORRELATION_HEADER];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === undefined || candidate.trim().length === 0
    ? randomUUID()
    : candidate.trim().slice(0, 128);
};

/**
 * Authentication is out of scope (NG-3), so the tenant arrives in a header and is trusted. This
 * function is where a real authentication layer would slot in, which is the reason it exists at all
 * rather than the header being read inline in each route.
 */
export const userIdOf = (request: FastifyRequest): UserId => {
  const value = headerValue(request, USER_HEADER);
  if (value === null) {
    throw new ValidationError(`${USER_HEADER} header is required`);
  }
  return UserId(value);
};

export const idempotencyKeyOf = (request: FastifyRequest): string => {
  const value = headerValue(request, IDEMPOTENCY_HEADER);
  if (value === null) {
    // Required rather than optional. The recovery path for a failed publish is the client retrying
    // with the same key, so an intake without one has no way back from a partial failure.
    throw new ValidationError(`${IDEMPOTENCY_HEADER} header is required for this endpoint`);
  }
  if (value.length > 255) {
    throw new ValidationError(`${IDEMPOTENCY_HEADER} must be at most 255 characters`);
  }
  return value;
};

/**
 * Identifies *what* was requested, so the same key used for a different request can be rejected
 * instead of silently answered with the first request's result.
 *
 * Keys are sorted before hashing so that a client reordering its JSON fields is not treated as a
 * different request.
 */
export const fingerprintOf = (body: unknown): string =>
  createHash('sha256').update(canonicalize(body)).digest('hex');

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(',')}}`;
};
