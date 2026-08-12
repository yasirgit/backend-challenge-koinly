import { pino, type Logger } from 'pino';

export type AppLogger = Logger;

/**
 * Structured logs with a correlation identifier are the whole observability story in this
 * iteration (see NG-5). One field, `correlationId`, follows a request from HTTP intake through the
 * message headers into the worker, so a single import is greppable end to end.
 */
export const createLogger = (options: {
  readonly level: string;
  readonly service: string;
}): AppLogger =>
  pino({
    level: options.level,
    base: { service: options.service },
    // Instants in logs are ISO-8601 UTC for the same reason they are in the database: a log line
    // correlated with a transaction has to be comparable to it without guessing a timezone.
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ['req.headers.authorization'], remove: true },
  });
