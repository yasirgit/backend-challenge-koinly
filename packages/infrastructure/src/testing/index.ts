/**
 * Helpers for suites that need the real containers from `pnpm infra:up`.
 *
 * A separate entrypoint from the package root so that importing the infrastructure layer never
 * drags test-only code — or its assumptions about which database to talk to — into a running
 * process.
 */
export {
  TEST_DATABASE_URL,
  TEST_RABBITMQ_URL,
  TEST_RETRY_DELAY_MS,
  connectTestDatabase,
  uniqueSuffix,
} from './test-database.js';
