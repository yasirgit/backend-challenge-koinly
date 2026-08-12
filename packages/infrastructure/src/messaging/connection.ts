import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';

import type { AppLogger } from '../observability/logger.js';
import { assertTopology } from './topology.js';

export interface BrokerHandle {
  readonly connection: ChannelModel;
  readonly channel: ConfirmChannel;
  /** Whether the channel is currently usable, for the readiness endpoint. */
  readonly isOpen: () => boolean;
  readonly close: () => Promise<void>;
}

/**
 * Opens a confirm channel and declares the topology.
 *
 * A confirm channel rather than a plain one because a publish that is not confirmed is a publish
 * that may not have happened, and intake needs to know the difference: the whole persist-then-
 * publish story in ADR-0011 depends on a failed publish being observable.
 *
 * Both API and worker declare the topology on startup. Declarations are idempotent, and having
 * both do it means neither has to be started first.
 */
export const connectBroker = async (options: {
  readonly url: string;
  readonly retryDelayMs: number;
  readonly logger: AppLogger;
}): Promise<BrokerHandle> => {
  const connection = await connect(options.url);
  const channel = await connection.createConfirmChannel();

  await assertTopology(channel, { retryDelayMs: options.retryDelayMs });

  let open = true;
  connection.on('error', (error: Error) => {
    options.logger.error({ err: error }, 'broker connection error');
  });
  connection.on('close', () => {
    open = false;
    options.logger.warn('broker connection closed');
  });
  channel.on('close', () => {
    open = false;
  });

  return {
    connection,
    channel,
    isOpen: () => open,
    close: async () => {
      // Closing the channel first lets in-flight acknowledgements land before the socket goes.
      try {
        await channel.close();
      } finally {
        await connection.close();
      }
    },
  };
};
