import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Unit tier: domain and use-case tests. Runs with no infrastructure so it can be the suite that
 * runs on every save. Integration tiers live in vitest.integration.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@app/domain': fromRoot('./packages/domain/src/index.ts'),
      '@app/application/testing': fromRoot('./packages/application/src/testing/index.ts'),
      '@app/application': fromRoot('./packages/application/src/index.ts'),
      '@app/infrastructure': fromRoot('./packages/infrastructure/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
