import { describe, expect, it } from 'vitest';

import { ConflictError, JobPublicationError, NotFoundError } from '../errors.js';
import { OTHER_USER_ID, USER_ID, WALLET_ID, createHarness } from '../testing/scenario.js';
import {
  createRequestImportUseCase,
  type RequestImportCommand,
} from './request-import.use-case.js';

const command = (overrides: Partial<RequestImportCommand> = {}): RequestImportCommand => ({
  userId: USER_ID,
  walletId: WALLET_ID,
  payloadRef: 'acme-exchange/trades.csv',
  idempotencyKey: 'key-1',
  requestFingerprint: 'fingerprint-1',
  correlationId: 'corr-1',
  ...overrides,
});

const setup = (): ReturnType<typeof createHarness> & {
  useCase: ReturnType<typeof createRequestImportUseCase>;
} => {
  const harness = createHarness();
  return { ...harness, useCase: createRequestImportUseCase(harness) };
};

describe('requesting an import', () => {
  it('records the import and queues exactly one job', async () => {
    const { useCase, publisher, imports } = setup();

    const { record, created } = await useCase.execute(command());

    expect(created).toBe(true);
    expect(record.status).toBe('pending');
    expect(imports.items.size).toBe(1);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.importId).toBe(record.id);
  });

  it('never touches transaction storage: the work happens in the worker', async () => {
    const { useCase, transactions } = setup();
    await useCase.execute(command());
    expect(transactions.items.size).toBe(0);
  });

  it('takes the source type from the wallet rather than the request', async () => {
    const { useCase } = setup();
    const { record } = await useCase.execute(command());
    expect(record.sourceType).toBe('acme_exchange_csv');
  });

  it('returns the original import when the same key is replayed', async () => {
    const { useCase, imports } = setup();

    const first = await useCase.execute(command());
    const second = await useCase.execute(command());

    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(imports.items.size).toBe(1);
  });

  it('rejects a key reused for a different request', async () => {
    const { useCase } = setup();

    await useCase.execute(command());

    // Silently returning the first import here would answer a question the client did not ask.
    await expect(
      useCase.execute(command({ payloadRef: 'other.csv', requestFingerprint: 'fingerprint-2' })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('republishes an import that is still pending, which is how a lost publish is recovered', async () => {
    const { useCase, publisher } = setup();

    // The broker was down when the import was first requested: the row exists, the job does not.
    publisher.failNext = true;
    const failure = await useCase.execute(command()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobPublicationError);
    expect((failure as JobPublicationError).details['importId']).toBeDefined();
    expect(publisher.published).toHaveLength(0);

    // The client retries with the same key. No second import, but the job finally gets queued.
    const retried = await useCase.execute(command());

    expect(retried.created).toBe(false);
    expect(retried.record.status).toBe('pending');
    expect(publisher.published).toHaveLength(1);
  });

  it('does not republish an import that already finished', async () => {
    const { useCase, imports, publisher, clock } = setup();

    const { record } = await useCase.execute(command());
    await imports.complete(record.id, { total: 1, imported: 1, skipped: 0 }, clock.now());

    await useCase.execute(command());

    expect(publisher.published).toHaveLength(1);
  });

  it('hides wallets belonging to another user behind a not-found', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(command({ userId: OTHER_USER_ID }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
