import type { Socket } from 'node:net';

import { TEST_RABBITMQ_URL, TEST_RETRY_DELAY_MS } from '../testing/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { connectBroker, type BrokerHandle } from './connection.js';
import { createLogger } from '../observability/logger.js';

/**
 * Why a whole suite for one boolean: this is the difference between "the broker restarted" and "the
 * service needs a human". Nothing here reconnects, so both processes end themselves when the
 * connection dies and let their supervisor supply a live one. That only works if a drop is
 * distinguishable from the close() we asked for — otherwise every graceful shutdown reports itself
 * as a crash, and the exit code stops meaning anything.
 *
 * Requires `pnpm infra:up`.
 */

const logger = createLogger({ level: 'silent', service: 'connection-test' });

const connect = (): Promise<BrokerHandle> =>
  connectBroker({ url: TEST_RABBITMQ_URL, retryDelayMs: TEST_RETRY_DELAY_MS, logger });

/** No public amqplib API severs a connection without asking politely, and a polite close is the
 *  case we are trying to tell apart. Killing the socket is the closest thing to a pulled cable. */
const killSocket = (broker: BrokerHandle): void => {
  const stream = (broker.connection.connection as unknown as { stream: Socket }).stream;
  stream.destroy(new Error('simulated network failure'));
};

const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe('connectBroker', () => {
  let broker: BrokerHandle | undefined;

  afterEach(async () => {
    if (broker !== undefined && broker.isOpen()) {
      await broker.close();
    }
    broker = undefined;
  });

  it('reports an unprompted drop to every registered handler', async () => {
    broker = await connect();
    const notified: string[] = [];
    broker.onLost(() => notified.push('first'));
    broker.onLost(() => notified.push('second'));

    killSocket(broker);
    await nextTick();

    expect(notified).toEqual(['first', 'second']);
    expect(broker.isOpen()).toBe(false);
  });

  it('stays quiet when the connection is closed on purpose', async () => {
    broker = await connect();
    let notified = false;
    broker.onLost(() => {
      notified = true;
    });

    await broker.close();
    await nextTick();

    expect(notified).toBe(false);
    expect(broker.isOpen()).toBe(false);
  });

  it('reports readiness while the channel is usable', async () => {
    broker = await connect();

    expect(broker.isOpen()).toBe(true);
  });
});
