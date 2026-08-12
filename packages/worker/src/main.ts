import { createWorkerContainer } from './container.js';

const main = async (): Promise<void> => {
  const container = await createWorkerContainer();
  const consumer = await container.start();

  container.logger.info(
    { prefetch: container.config.queue.prefetch, maxAttempts: container.config.queue.maxAttempts },
    'worker consuming imports',
  );

  /**
   * Graceful shutdown, in this order: stop taking deliveries, let in-flight messages finish and
   * acknowledge, then close the connections.
   *
   * Skipping this would still be *correct* — an unacknowledged message is redelivered and
   * processing is idempotent — but every deploy would leave half-finished imports to be redone,
   * and the logs would fill with retries that were nobody's fault.
   */
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    container.logger.info({ signal }, 'draining before shutdown');

    void (async () => {
      try {
        await consumer.stop();
        await container.close();
        process.exit(0);
      } catch (error: unknown) {
        container.logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : 'unknown startup failure'}\n`);
  process.exit(1);
});
