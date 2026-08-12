import { ImportId, createImport, type ImportRecord, type TransactionDraft } from '@app/domain';
import { AssetRef, Decimal } from '@app/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConcurrencyError, NotFoundError, ValidationError } from '../errors.js';
import { SOURCE_TYPE, USER_ID, WALLET_ID, createHarness } from '../testing/scenario.js';
import {
  createProcessImportUseCase,
  type ProcessImportUseCase,
} from './process-import.use-case.js';

const IMPORT_ID = ImportId('01900000-0000-7000-8000-00000000f001');

const draft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  sourceId: null,
  kind: 'trade',
  occurredAt: new Date('2024-03-01T10:00:00.000Z'),
  legs: [
    { direction: 'in', asset: AssetRef('ETH'), quantity: Decimal.from('0.5') },
    { direction: 'out', asset: AssetRef('USDC'), quantity: Decimal.from('1200') },
  ],
  ...overrides,
});

const pendingImport = (): ImportRecord =>
  createImport({
    id: IMPORT_ID,
    userId: USER_ID,
    walletId: WALLET_ID,
    sourceType: SOURCE_TYPE,
    payloadRef: 'acme-exchange/trades.csv',
    idempotencyKey: 'key-1',
    requestFingerprint: 'fingerprint-1',
    createdAt: new Date('2024-06-01T12:00:00.000Z'),
  });

describe('processing an import', () => {
  let harness: ReturnType<typeof createHarness>;
  let useCase: ProcessImportUseCase;

  beforeEach(async () => {
    harness = createHarness([draft(), draft({ occurredAt: new Date('2024-03-02T10:00:00.000Z') })]);
    useCase = createProcessImportUseCase({ ...harness, batchSize: 1 });
    await harness.imports.create(pendingImport());
  });

  it('normalizes the payload and completes the import', async () => {
    const result = await useCase.execute({ importId: IMPORT_ID });

    expect(result.outcome).toBe('completed');
    expect(result.counts).toStrictEqual({ total: 2, imported: 2, skipped: 0 });

    const record = await harness.imports.findById(IMPORT_ID);
    expect(record?.status).toBe('completed');
    expect(record?.attempts).toBe(1);
    expect(harness.transactions.items.size).toBe(2);
  });

  it('is idempotent: reprocessing the same import writes nothing new', async () => {
    await useCase.execute({ importId: IMPORT_ID });

    // Force the import back to pending, as a redelivery of a message for an import whose
    // completion was never recorded would find it.
    harness.imports.items.set(IMPORT_ID, {
      ...(await harness.imports.findById(IMPORT_ID))!,
      status: 'pending',
    });

    const replay = await useCase.execute({ importId: IMPORT_ID });

    expect(replay.counts).toStrictEqual({ total: 2, imported: 0, skipped: 2 });
    expect(harness.transactions.items.size).toBe(2);
  });

  it('short-circuits a duplicate delivery of a finished import without re-reading the payload', async () => {
    await useCase.execute({ importId: IMPORT_ID });
    const readsAfterFirstRun = harness.adapter.reads;

    const duplicate = await useCase.execute({ importId: IMPORT_ID });

    expect(duplicate.outcome).toBe('already-completed');
    expect(harness.adapter.reads).toBe(readsAfterFirstRun);
  });

  it('takes over an import abandoned by a crashed worker', async () => {
    // What a crash leaves behind: status `processing`, one attempt recorded, no result.
    await harness.imports.beginAttempt(IMPORT_ID, new Date('2024-06-01T12:00:00.000Z'));

    const result = await useCase.execute({ importId: IMPORT_ID });

    expect(result.outcome).toBe('completed');
    const record = await harness.imports.findById(IMPORT_ID);
    expect(record?.attempts).toBe(2);
  });

  it('refuses to run while another worker holds the lock', async () => {
    harness.imports.locked.add(IMPORT_ID);

    // Retryable rather than fatal: the other worker will finish, and this message comes back later.
    await expect(useCase.execute({ importId: IMPORT_ID })).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('fails permanently when the payload names an unknown asset', async () => {
    harness.adapter.setDrafts([
      draft({
        legs: [{ direction: 'in', asset: AssetRef('SCAMCOIN'), quantity: Decimal.from('1') }],
        kind: 'deposit',
      }),
    ]);

    await expect(useCase.execute({ importId: IMPORT_ID })).rejects.toThrow();

    const record = await harness.imports.findById(IMPORT_ID);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('UNKNOWN_ASSET');
  });

  it('leaves the import recoverable when a dependency fails transiently', async () => {
    harness.adapter.failWith = new Error('connection reset by peer');

    await expect(useCase.execute({ importId: IMPORT_ID })).rejects.toThrow('connection reset');

    // Not marked failed: an unknown error is treated as transient, so the redelivered message can
    // still succeed. Marking it failed here would turn a blip into a lost import.
    const record = await harness.imports.findById(IMPORT_ID);
    expect(record?.status).toBe('processing');
  });

  it('rejects a message for an import that does not exist', async () => {
    await expect(
      useCase.execute({ importId: ImportId('01900000-0000-7000-8000-00000000f999') }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fails permanently when no adapter is registered for the source', async () => {
    harness.sources.adapters.clear();
    await expect(useCase.execute({ importId: IMPORT_ID })).rejects.toBeInstanceOf(ValidationError);
  });

  it('produces the same rows whether the payload is processed in one chunk or many', async () => {
    const oneChunk = createHarness([draft(), draft(), draft()]);
    await oneChunk.imports.create(pendingImport());
    await createProcessImportUseCase({ ...oneChunk, batchSize: 100 }).execute({
      importId: IMPORT_ID,
    });

    const manyChunks = createHarness([draft(), draft(), draft()]);
    await manyChunks.imports.create(pendingImport());
    await createProcessImportUseCase({ ...manyChunks, batchSize: 1 }).execute({
      importId: IMPORT_ID,
    });

    // Chunking is an execution detail. If it changed the natural keys, a large import would
    // duplicate itself the first time the batch size was tuned.
    expect([...manyChunks.transactions.items.keys()].sort()).toStrictEqual(
      [...oneChunk.transactions.items.keys()].sort(),
    );
    expect(manyChunks.transactions.items.size).toBe(3);
  });
});
