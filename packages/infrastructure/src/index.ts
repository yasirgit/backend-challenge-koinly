/**
 * The infrastructure layer: adapters that implement the application's ports.
 *
 * Everything here knows about a specific technology — PostgreSQL, RabbitMQ, the filesystem — and
 * nothing here knows about a use case. Wiring the two together is the composition root's job, and
 * a dependency-cruiser rule enforces that an adapter never reaches for a use case.
 */

export { ConfigurationError, loadConfig } from './config/config.js';
export type { AppConfig } from './config/config.js';

export { createLogger } from './observability/logger.js';
export type { AppLogger } from './observability/logger.js';

export { systemClock, uuidV7Generator } from './adapters/system.js';

export { createDatabase } from './db/client.js';
export type { AppDatabase, DatabaseHandle } from './db/client.js';
export { createMigrator, migrateDown, migrateToLatest } from './db/migrator.js';
export type { Database, ImportStatus } from './db/schema.js';

export { PostgresAssetResolver } from './db/repositories/asset.repository.js';
export { PostgresImportRepository } from './db/repositories/import.repository.js';
export { PostgresTransactionRepository } from './db/repositories/transaction.repository.js';
export { PostgresWalletRepository } from './db/repositories/wallet.repository.js';

export { connectBroker } from './messaging/connection.js';
export type { BrokerHandle } from './messaging/connection.js';
export { RabbitImportJobPublisher } from './messaging/publisher.js';
export { startImportConsumer } from './messaging/consumer.js';
export type { ConsumerHandle, ImportConsumerOptions } from './messaging/consumer.js';
export { TOPOLOGY, assertTopology } from './messaging/topology.js';
export { MalformedMessageError, parseEnvelope, toEnvelope, toJob } from './messaging/envelope.js';
export type { ImportRequestedEnvelope } from './messaging/envelope.js';
export { decideRetry } from './messaging/retry-policy.js';
export type { DeadLetterReason, RetryDecision } from './messaging/retry-policy.js';

export { createSourceRegistry } from './sources/registry.js';
export { FixturePayloadStore } from './sources/payload-store.js';
export { ACME_EXCHANGE_CSV, AcmeExchangeCsvAdapter } from './sources/acme-exchange-csv.adapter.js';
export { FAKE_CHAIN_JSON, FakeChainJsonAdapter } from './sources/fake-chain-json.adapter.js';
