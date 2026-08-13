import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';

import type { AppLogger } from '../observability/logger.js';
import { assertTopology } from './topology.js';

export interface BrokerHandle {
  readonly connection: ChannelModel;
  readonly channel: ConfirmChannel;
  /** Whether the channel is currently usable, for the readiness endpoint. */
  readonly isOpen: () => boolean;
  /**
   * Registers a handler for a drop that close() did not ask for.
   *
   * amqplib does not reconnect, and neither do we: re-establishing a confirm channel means
   * redeclaring topology, re-registering consumers and reasoning about publishes that were in
   * flight when the socket died, which is a state machine that earns its keep only once there is a
   * reason to avoid a restart. Instead the process ends and its supervisor starts a replacement
   * with a connection known to be good. That is safe here because imports are durable before they
   * are published and processing is idempotent, so a restart re-does work rather than losing it.
   */
  readonly onLost: (handler: () => void) => void;
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
  let closingOnPurpose = false;
  const lostHandlers: (() => void)[] = [];

  connection.on('error', (error: Error) => {
    options.logger.error({ err: error }, 'broker connection error');
  });
  connection.on('close', () => {
    open = false;
    options.logger.warn('broker connection closed');
    if (closingOnPurpose) {
      return;
    }
    for (const handler of lostHandlers) {
      handler();
    }
  });
  channel.on('close', () => {
    open = false;
  });

  return {
    connection,
    channel,
    isOpen: () => open,
    onLost: (handler) => {
      lostHandlers.push(handler);
    },
    close: async () => {
      closingOnPurpose = true;
      // Closing the channel first lets in-flight acknowledgements land before the socket goes.
      try {
        await channel.close();
      } finally {
        await connection.close();
      }
    },
  };
};
