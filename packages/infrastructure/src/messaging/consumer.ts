import type { ImportRequestedJob } from '@app/application';
import { describeError } from '@app/application';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { AppLogger } from '../observability/logger.js';
import { parseEnvelope, toJob } from './envelope.js';
import { ATTEMPT_HEADER, CORRELATION_HEADER, DEAD_LETTER_REASON_HEADER, readAttempt } from './headers.js';
import { decideRetry, type DeadLetterReason } from './retry-policy.js';
import { TOPOLOGY } from './topology.js';

export interface ImportConsumerOptions {
  readonly channel: ConfirmChannel;
  readonly logger: AppLogger;
  readonly prefetch: number;
  readonly maxAttempts: number;
  readonly handle: (job: ImportRequestedJob, logger: AppLogger) => Promise<void>;
  /**
   * Called just before a message is parked, so the worker can record the terminal failure against
   * the import. Kept as a callback rather than a repository dependency: the consumer's job is
   * message plumbing, and giving it a database would be exactly the layering violation the
   * dependency rules exist to prevent.
   */
  readonly onDeadLetter?: (
    job: ImportRequestedJob | null,
    reason: DeadLetterReason,
    error: unknown,
  ) => Promise<void>;
}

export interface ConsumerHandle {
  /** Stops delivery and waits for in-flight messages to finish. */
  readonly stop: () => Promise<void>;
}

export const startImportConsumer = async (
  options: ImportConsumerOptions,
): Promise<ConsumerHandle> => {
  const { channel, logger } = options;

  // Bounds in-flight work per worker. This is the backpressure knob: without it a worker pulls the
  // whole queue into memory and the broker loses its ability to spread load across consumers.
  await channel.prefetch(options.prefetch);

  const inFlight = new Set<Promise<void>>();

  const republish = (
    queue: string,
    message: ConsumeMessage,
    headers: Record<string, unknown>,
  ): void => {
    // The default exchange routes by queue name, which is how a message reaches the retry queue
    // without a binding of its own.
    channel.sendToQueue(queue, message.content, {
      persistent: true,
      contentType: message.properties.contentType as string | undefined,
      messageId: message.properties.messageId as string | undefined,
      correlationId: message.properties.correlationId as string | undefined,
      type: message.properties.type as string | undefined,
      headers,
    });
  };

  const park = (message: ConsumeMessage, reason: DeadLetterReason): void => {
    channel.publish(TOPOLOGY.deadLetterExchange, TOPOLOGY.routingKey, message.content, {
      persistent: true,
      headers: {
        ...(message.properties.headers ?? {}),
        [DEAD_LETTER_REASON_HEADER]: reason,
      },
    });
  };

  const handleMessage = async (message: ConsumeMessage): Promise<void> => {
    const headers = (message.properties.headers ?? {}) as Record<string, unknown>;
    const attempt = readAttempt(headers);
    let job: ImportRequestedJob | null = null;

    try {
      job = toJob(parseEnvelope(message.content));
      const scopedLogger = logger.child({
        correlationId: job.correlationId,
        importId: job.importId,
        attempt,
      });

      await options.handle(job, scopedLogger);
      channel.ack(message);
      scopedLogger.info('import message handled');
      return;
    } catch (error: unknown) {
      const decision = decideRetry({ error, attempt, maxAttempts: options.maxAttempts });
      const described = describeError(error);

      if (decision.action === 'retry') {
        logger.warn(
          { err: described, attempt, nextAttempt: decision.nextAttempt, importId: job?.importId },
          'import message failed; scheduling retry',
        );
        republish(TOPOLOGY.retryQueue, message, {
          ...headers,
          [ATTEMPT_HEADER]: decision.nextAttempt,
          [CORRELATION_HEADER]: job?.correlationId ?? headers[CORRELATION_HEADER],
        });
        // Acked rather than nacked: the message has been handed to the retry queue, and leaving the
        // original unacknowledged as well would put two copies of the same job in flight.
        channel.ack(message);
        return;
      }

      logger.error(
        { err: described, attempt, reason: decision.reason, importId: job?.importId },
        'import message parked in the dead-letter queue',
      );

      try {
        await options.onDeadLetter?.(job, decision.reason, error);
      } catch (recordingError: unknown) {
        // Never let bookkeeping stop the message from being parked; a message stuck in redelivery
        // is worse than an import whose failure was not written down.
        logger.error({ err: describeError(recordingError) }, 'failed to record dead-letter reason');
      }

      park(message, decision.reason);
      channel.ack(message);
    }
  };

  const { consumerTag } = await channel.consume(
    TOPOLOGY.queue,
    (message) => {
      if (message === null) {
        return;
      }
      const task = handleMessage(message).finally(() => inFlight.delete(task));
      inFlight.add(task);
    },
    { noAck: false },
  );

  return {
    stop: async () => {
      // Cancel first so no new deliveries arrive, then drain. Without this, a deploy would leave
      // half-processed imports to be redelivered — safe, thanks to idempotency, but wasteful and
      // noisy.
      await channel.cancel(consumerTag);
      await Promise.allSettled([...inFlight]);
    },
  };
};
