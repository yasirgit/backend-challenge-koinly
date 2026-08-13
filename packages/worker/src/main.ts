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
  const shutdown = (reason: string, code: number): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    container.logger.info({ reason }, 'draining before shutdown');

    void (async () => {
      try {
        await consumer.stop();
        await container.close();
        process.exit(code);
      } catch (error: unknown) {
        container.logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM', 0);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT', 0);
  });

  /**
   * A worker that loses the broker stops consuming, and with nothing else holding the event loop it
   * would drift out of the process exiting 0 — which looks like a clean shutdown in every log and
   * dashboard. Saying so explicitly, with a non-zero code, keeps the restart honest.
   */
  container.onBrokerLost(() => {
    container.logger.fatal('broker connection lost; exiting to be replaced with a live connection');
    shutdown('broker-lost', 1);
  });
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : 'unknown startup failure'}\n`);
  process.exit(1);
});
