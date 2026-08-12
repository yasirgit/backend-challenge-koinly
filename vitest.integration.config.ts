import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Integration tier: repository contract tests against real PostgreSQL and the end-to-end pipeline
 * test against real PostgreSQL and RabbitMQ. Requires `pnpm infra:up`.
 *
 * Single-threaded on purpose: these tests share one database, and a shared database with parallel
 * writers turns unrelated failures into flakes.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@app/domain': fromRoot('./packages/domain/src/index.ts'),
      '@app/application/testing': fromRoot('./packages/application/src/testing/index.ts'),
      '@app/application': fromRoot('./packages/application/src/index.ts'),
      '@app/infrastructure/testing': fromRoot('./packages/infrastructure/src/testing/index.ts'),
      '@app/infrastructure': fromRoot('./packages/infrastructure/src/index.ts'),
      '@app/api': fromRoot('./packages/api/src/index.ts'),
      '@app/worker': fromRoot('./packages/worker/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.integration.test.ts', 'tests/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
