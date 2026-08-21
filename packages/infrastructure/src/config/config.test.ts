import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig, loadDatabaseConfig } from './config.js';

const databaseEnv = {
  DATABASE_URL: 'postgres://koinly:koinly@localhost:55432/koinly_test',
};

const appEnv = {
  ...databaseEnv,
  RABBITMQ_URL: 'amqp://koinly:koinly@localhost:55672',
};

describe('loadDatabaseConfig', () => {
  it('accepts DATABASE_URL without a broker URL', () => {
    const config = loadDatabaseConfig(databaseEnv);
    expect(config.database.url).toBe(databaseEnv.DATABASE_URL);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadDatabaseConfig({})).toThrow(ConfigurationError);
    expect(() => loadDatabaseConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe('loadConfig', () => {
  it('still requires RABBITMQ_URL for the application', () => {
    expect(() => loadConfig(databaseEnv)).toThrow(ConfigurationError);
    expect(() => loadConfig(databaseEnv)).toThrow(/RABBITMQ_URL/);
  });

  it('loads the full application configuration', () => {
    const config = loadConfig(appEnv);
    expect(config.database.url).toBe(appEnv.DATABASE_URL);
    expect(config.queue.url).toBe(appEnv.RABBITMQ_URL);
  });
});
