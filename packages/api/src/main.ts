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
  const shutdown = (signal: string): void => {
    container.logger.info({ signal }, 'shutting down');
    void (async () => {
      try {
        await app.close();
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

  await app.listen({ port: container.config.api.port, host: container.config.api.host });
};

main().catch((error: unknown) => {
  // Configuration or a dependency failed before a logger existed, so this goes to stderr rather
  // than pretending there is somewhere structured to put it.
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : 'unknown startup failure'}\n`);
  process.exit(1);
});
