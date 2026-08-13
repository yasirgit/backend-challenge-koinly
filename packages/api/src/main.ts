import { createApiContainer } from './container.js';
import { buildServer } from './server.js';

const main = async (): Promise<void> => {
  const container = await createApiContainer();
  const app = buildServer({
    useCases: container.useCases,
    logger: container.logger,
    checkReadiness: container.checkReadiness,
  });

  /**
   * Stop accepting connections, let in-flight requests finish, then release the pool and the
   * broker channel. Without this, a rolling deploy answers a handful of requests with a reset
   * connection for no reason.
   */
  let ending = false;
  const shutdown = (reason: string, code: number): void => {
    if (ending) {
      return;
    }
    ending = true;
    container.logger.info({ reason }, 'shutting down');
    void (async () => {
      try {
        await app.close();
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
   * Without this the process survives a broker restart holding a channel that will never publish
   * again: readiness reports false forever and every import returns 502, because nothing here
   * reconnects. Ending deliberately hands the problem to the restart policy, which is the one
   * component that can actually fix it.
   */
  container.onBrokerLost(() => {
    container.logger.fatal('broker connection lost; exiting to be replaced with a live connection');
    shutdown('broker-lost', 1);
  });

  await app.listen({ port: container.config.api.port, host: container.config.api.host });
};

main().catch((error: unknown) => {
  // Configuration or a dependency failed before a logger existed, so this goes to stderr rather
  // than pretending there is somewhere structured to put it.
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : 'unknown startup failure'}\n`);
  process.exit(1);
});
