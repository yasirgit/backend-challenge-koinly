import type { ImportJobPublisher, ImportRequestedJob } from '@app/application';
import type { ConfirmChannel } from 'amqplib';

import type { Clock, IdGenerator } from '@app/application';
import { toError } from '../observability/to-error.js';
import { toEnvelope } from './envelope.js';
import { ATTEMPT_HEADER, CORRELATION_HEADER } from './headers.js';
import { TOPOLOGY } from './topology.js';

export class RabbitImportJobPublisher implements ImportJobPublisher {
  constructor(
    private readonly channel: ConfirmChannel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Resolves only once the broker has confirmed the message, so a caller that sees this promise
   * settle knows the job is durable. A rejection means the job is not queued — which the intake use
   * case surfaces to the client rather than pretending the import is on its way.
   */
  publish(job: ImportRequestedJob): Promise<void> {
    const envelope = toEnvelope(job, {
      messageId: this.ids.newId(),
      occurredAt: this.clock.now(),
    });

    return new Promise((resolve, reject) => {
      this.channel.publish(
        TOPOLOGY.exchange,
        TOPOLOGY.routingKey,
        Buffer.from(JSON.stringify(envelope), 'utf8'),
        {
          // Survives a broker restart. Pointless without a durable queue, and vice versa.
          persistent: true,
          contentType: 'application/json',
          messageId: envelope.messageId,
          correlationId: envelope.correlationId,
          type: envelope.type,
          timestamp: Math.floor(this.clock.now().getTime() / 1000),
          headers: {
            [ATTEMPT_HEADER]: 1,
            [CORRELATION_HEADER]: envelope.correlationId,
          },
        },
        (error: unknown) => {
          if (error === null || error === undefined) {
            resolve();
          } else {
            reject(toError(error));
          }
        },
      );
    });
  }
}
