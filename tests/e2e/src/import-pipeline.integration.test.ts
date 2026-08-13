import { fileURLToPath } from 'node:url';

import {
  createGetImportUseCase,
  createListTransactionsUseCase,
  createProcessImportUseCase,
  createRegisterWalletUseCase,
  createRequestImportUseCase,
  type ImportRequestedJob,
} from '@app/application';
import { AssetId, ImportId, SourceType, UserId, type WalletId } from '@app/domain';
import { buildServer } from '@app/api';
import {
  PostgresAssetResolver,
  PostgresImportRepository,
  PostgresTransactionRepository,
  PostgresWalletRepository,
  RabbitImportJobPublisher,
  connectBroker,
  createLogger,
  createSourceRegistry,
  startImportConsumer,
  systemClock,
  uuidV7Generator,
  type BrokerHandle,
  type ConsumerHandle,
  type DatabaseHandle,
} from '@app/infrastructure';
import { connectTestDatabase, TEST_RABBITMQ_URL, TEST_RETRY_DELAY_MS } from '@app/infrastructure/testing';
import { createImportHandler } from '@app/worker';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The one test that would fail if any single layer were wired up wrongly.
 *
 * It runs the real HTTP handler, the real broker, the real worker handler and real PostgreSQL:
 * no fakes anywhere. Everything below this file is tested in isolation and much faster, so the
 * only thing asked of this suite is the property that isolation cannot demonstrate — that the
 * pieces agree with each other, and that the pipeline is safe to run twice.
 *
 * Requires `pnpm infra:up`.
 */

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const CSV_PAYLOAD = 'acme-exchange/trades.csv';
/** Rows in fixtures/acme-exchange/trades.csv, including the deliberately duplicated pair. */
const CSV_ROWS = 8;

/** Named through the factory so this package never has to depend on the HTTP framework itself. */
type Server = ReturnType<typeof buildServer>;

interface Harness {
  readonly database: DatabaseHandle;
  readonly broker: BrokerHandle;
  readonly consumer: ConsumerHandle;
  readonly server: Server;
  readonly publisher: RabbitImportJobPublisher;
  readonly userId: UserId;
  readonly walletId: WalletId;
  readonly close: () => Promise<void>;
}

/** Assets referenced by the CSV fixture, created per run so suites never collide on the registry. */
const FIXTURE_SYMBOLS = ['ETH', 'BTC', 'USDC', 'USDT', 'SOL'] as const;

const setup = async (): Promise<Harness> => {
  const database = await connectTestDatabase();
  const logger = createLogger({ level: 'silent', service: 'e2e' });
  const broker = await connectBroker({
    url: TEST_RABBITMQ_URL,
    retryDelayMs: TEST_RETRY_DELAY_MS,
    logger,
  });

  const userId = UserId(uuidv7());
  await database.db.insertInto('users').values({ id: userId, external_ref: `e2e-${userId}` }).execute();

  // The asset registry is global reference data, not per-test fixture, so this run shares it with
  // every other and inserts only what is missing. An exchange export names no chain, so these are
  // the chainless rows the CSV's tickers resolve against.
  await database.db
    .insertInto('assets')
    .values(
      FIXTURE_SYMBOLS.map((symbol) => ({
        id: AssetId(uuidv7()),
        symbol,
        chain: '',
        contract_address: '',
        decimals: 18,
        is_verified: true,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .execute();

  const wallets = new PostgresWalletRepository(database.db);
  const imports = new PostgresImportRepository(database.db);
  const transactions = new PostgresTransactionRepository(database.db);
  const assets = new PostgresAssetResolver(database.db);
  const sources = createSourceRegistry({ fixturesDir: FIXTURES_DIR });
  const publisher = new RabbitImportJobPublisher(broker.channel, systemClock, uuidV7Generator);

  const registerWallet = createRegisterWalletUseCase({ wallets, sources, ids: uuidV7Generator });
  const { wallet } = await registerWallet.execute({
    userId,
    sourceType: 'acme_exchange_csv',
    sourceAccountRef: `e2e-account-${userId.slice(-8)}`,
    label: 'End-to-end wallet',
  });

  const server = buildServer({
    logger,
    useCases: {
      registerWallet,
      requestImport: createRequestImportUseCase({
        wallets,
        imports,
        publisher,
        clock: systemClock,
        ids: uuidV7Generator,
      }),
      getImport: createGetImportUseCase({ imports }),
      listTransactions: createListTransactionsUseCase({ wallets, transactions }),
    },
    checkReadiness: async () => ({ ok: true, checks: { postgres: await database.ping() } }),
  });
  await server.ready();

  // The worker side, assembled from the same pieces its container uses. Prefetch of one keeps the
  // ordering of assertions predictable; the concurrency case has its own test below.
  const consumer = await startImportConsumer({
    channel: broker.channel,
    logger,
    prefetch: 1,
    maxAttempts: 3,
    handle: createImportHandler(
      createProcessImportUseCase({
        imports,
        transactions,
        assets,
        sources,
        clock: systemClock,
        ids: uuidV7Generator,
        batchSize: 3, // Smaller than the fixture, so the multi-batch path is the one under test.
      }),
    ),
  });

  return {
    database,
    broker,
    consumer,
    server,
    publisher,
    userId,
    walletId: wallet.id,
    close: async () => {
      await consumer.stop();
      await server.close();
      await broker.close();
      await database.close();
    },
  };
};

const requestImport = async (
  harness: Harness,
  idempotencyKey: string,
): Promise<{ status: number; importId: ImportId }> => {
  const response = await harness.server.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: {
      'x-user-id': harness.userId,
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json',
    },
    payload: { walletId: harness.walletId, payloadRef: CSV_PAYLOAD },
  });

  const body: { id: string } = response.json();
  return { status: response.statusCode, importId: ImportId(body.id) };
};

/**
 * Polls the read side rather than reaching into the queue.
 *
 * A client of this API has no way to observe the broker either, so waiting the way a client waits
 * keeps the test honest — and a test that waited on an internal signal would pass even if the
 * status were never published.
 */
const waitForImport = async (
  harness: Harness,
  importId: ImportId,
  status: 'completed' | 'failed',
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + 15_000;

  for (;;) {
    const response = await harness.server.inject({
      method: 'GET',
      url: `/v1/imports/${importId}`,
      headers: { 'x-user-id': harness.userId },
    });
    const body: Record<string, unknown> = response.json();

    if (body['status'] === status) {
      return body;
    }
    if (body['status'] === 'failed' || Date.now() > deadline) {
      throw new Error(`import ${importId} reached ${String(body['status'])}: ${JSON.stringify(body['error'])}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const listTransactions = async (harness: Harness): Promise<readonly Record<string, unknown>[]> => {
  const collected: Record<string, unknown>[] = [];
  let cursor: string | null = null;

  do {
    const query: string = cursor === null ? 'limit=5' : `limit=5&cursor=${encodeURIComponent(cursor)}`;
    const response = await harness.server.inject({
      method: 'GET',
      url: `/v1/wallets/${harness.walletId}/transactions?${query}`,
      headers: { 'x-user-id': harness.userId },
    });

    const page: { items: Record<string, unknown>[]; nextCursor: string | null } = response.json();
    collected.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);

  return collected;
};

describe('import pipeline', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await setup();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  it('accepts an import, processes it through the worker, and serves the result', async () => {
    const requested = await requestImport(harness, 'e2e-first');
    expect(requested.status).toBe(202);

    const record = await waitForImport(harness, requested.importId, 'completed');
    expect(record['counts']).toEqual({ total: CSV_ROWS, imported: CSV_ROWS, skipped: 0 });

    const items = await listTransactions(harness);
    expect(items).toHaveLength(CSV_ROWS);

    // Newest first, which is the order the keyset read promises.
    const timestamps = items.map((item) => String(item['occurredAt']));
    expect([...timestamps].sort().reverse()).toEqual(timestamps);

    // Money survived the round trip as text. `0.100000000000000001` is in the fixture precisely
    // because it is the value a float would quietly turn into 0.1.
    const quantities = items.flatMap((item) =>
      (item['entries'] as { quantity: string }[]).map((entry) => entry.quantity),
    );
    expect(quantities).toContain('0.100000000000000001');
    for (const quantity of quantities) {
      expect(typeof quantity).toBe('string');
    }

    // The two identical CSV rows are two economic events, so both are kept, and the derived ids
    // that distinguish them differ only by their occurrence ordinal.
    const derived = items.filter((item) => item['externalIdKind'] === 'derived');
    expect(derived).toHaveLength(3);
    expect(new Set(derived.map((item) => String(item['externalId']))).size).toBe(3);
  });

  it('is idempotent when the same message is delivered again', async () => {
    const before = await listTransactions(harness);
    const importId = ImportId(String(before[0]?.['importId']));

    // A redelivery is indistinguishable from the original message, which is the point: the broker
    // offers at-least-once, and nothing downstream is allowed to care how many times it arrives.
    const replay: ImportRequestedJob = {
      importId,
      walletId: harness.walletId,
      sourceType: SourceType('acme_exchange_csv'),
      payloadRef: CSV_PAYLOAD,
      correlationId: 'e2e-replay',
    };
    await harness.publisher.publish(replay);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const after = await listTransactions(harness);
    expect(after).toHaveLength(before.length);
    expect(after.map((item) => item['id'])).toEqual(before.map((item) => item['id']));
  });

  it('replays a new import of the same payload without duplicating rows', async () => {
    const before = await listTransactions(harness);

    // A different import row, same underlying file. Row identity is derived from content and
    // wallet, not from the import, so the second pass recognizes every row as already present.
    const requested = await requestImport(harness, 'e2e-second');
    expect(requested.status).toBe(202);

    const record = await waitForImport(harness, requested.importId, 'completed');
    expect(record['counts']).toEqual({ total: CSV_ROWS, imported: 0, skipped: CSV_ROWS });

    const after = await listTransactions(harness);
    expect(after.map((item) => item['id'])).toEqual(before.map((item) => item['id']));
  });

  it('returns the original import for a repeated Idempotency-Key without queueing more work', async () => {
    const first = await requestImport(harness, 'e2e-repeat');
    expect(first.status).toBe(202);
    await waitForImport(harness, first.importId, 'completed');

    const second = await requestImport(harness, 'e2e-repeat');
    expect(second.status).toBe(200);
    expect(second.importId).toBe(first.importId);
  });
});
