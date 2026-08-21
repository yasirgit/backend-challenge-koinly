import { z } from 'zod';

/**
 * The only module allowed to read the environment (enforced by an ESLint rule). Everything else
 * receives configuration as an argument, which is what lets a test construct an adapter pointed at
 * a different database without setting global state.
 *
 * Validation happens once, at startup, and a bad value stops the process. The alternative —
 * discovering a missing variable when the first message arrives — turns a configuration mistake
 * into a production incident.
 */
const positiveInt = (fallback: number): z.ZodDefault<z.ZodNumber> =>
  z.coerce.number().int().positive().default(fallback);

const databaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: positiveInt(10),
});

const configSchema = databaseSchema.extend({
  RABBITMQ_URL: z.string().url(),
  QUEUE_PREFETCH: positiveInt(4),
  QUEUE_MAX_ATTEMPTS: positiveInt(5),
  QUEUE_RETRY_DELAY_MS: positiveInt(5000),

  API_PORT: positiveInt(3000),
  API_HOST: z.string().default('0.0.0.0'),

  FIXTURES_DIR: z.string().default('./fixtures'),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly queue: {
    readonly url: string;
    readonly prefetch: number;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  };
  readonly api: {
    readonly port: number;
    readonly host: string;
  };
  readonly sources: {
    readonly fixturesDir: string;
  };
}

/** What migrate and seed actually use. They must not demand a broker they never open. */
export type DatabaseCliConfig = Pick<AppConfig, 'nodeEnv' | 'logLevel' | 'database'>;

export class ConfigurationError extends Error {
  constructor(issues: string) {
    super(`Invalid configuration:\n${issues}`);
    this.name = 'ConfigurationError';
  }
}

const parseOrThrow = <S extends z.ZodTypeAny>(schema: S, env: NodeJS.ProcessEnv): z.output<S> => {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigurationError(issues);
  }
  return parsed.data;
};

const toDatabaseConfig = (value: z.infer<typeof databaseSchema>): DatabaseCliConfig => ({
  nodeEnv: value.NODE_ENV,
  logLevel: value.LOG_LEVEL,
  database: { url: value.DATABASE_URL, poolMax: value.DATABASE_POOL_MAX },
});

export const loadDatabaseConfig = (env: NodeJS.ProcessEnv = process.env): DatabaseCliConfig =>
  toDatabaseConfig(parseOrThrow(databaseSchema, env));

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const value = parseOrThrow(configSchema, env);
  return {
    ...toDatabaseConfig(value),
    queue: {
      url: value.RABBITMQ_URL,
      prefetch: value.QUEUE_PREFETCH,
      maxAttempts: value.QUEUE_MAX_ATTEMPTS,
      retryDelayMs: value.QUEUE_RETRY_DELAY_MS,
    },
    api: { port: value.API_PORT, host: value.API_HOST },
    sources: { fixturesDir: value.FIXTURES_DIR },
  };
};
