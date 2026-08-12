import { ImportId, createImport, type ImportRecord, type UserId, type WalletId } from '@app/domain';

import { ConflictError, JobPublicationError, NotFoundError } from '../errors.js';
import type { ImportJobPublisher } from '../ports/messaging.js';
import type { ImportRepository, WalletRepository } from '../ports/repositories.js';
import type { Clock, IdGenerator } from '../ports/system.js';

export interface RequestImportCommand {
  readonly userId: UserId;
  readonly walletId: WalletId;
  readonly payloadRef: string;
  readonly idempotencyKey: string;
  /**
   * Hash of the canonicalized request body. Stored with the key so that reusing a key for a
   * different request is a conflict rather than a silently wrong answer.
   */
  readonly requestFingerprint: string;
  readonly correlationId: string;
}

export interface RequestImportResult {
  readonly record: ImportRecord;
  readonly created: boolean;
}

export interface RequestImportDeps {
  readonly wallets: WalletRepository;
  readonly imports: ImportRepository;
  readonly publisher: ImportJobPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface RequestImportUseCase {
  execute: (command: RequestImportCommand) => Promise<RequestImportResult>;
}

/**
 * Intake. Persists the import, then publishes the job.
 *
 * The order matters and the failure it leaves is deliberate: if the publish fails, an import row
 * exists that nothing will process, which is inert and inspectable. The other order would deliver
 * jobs for imports that do not exist yet, which is a hard error on the consumer's hot path. The
 * remaining window is closed opportunistically — see the republish below — and properly by an
 * outbox, which is not built (ADR-0011).
 */
export const createRequestImportUseCase = (deps: RequestImportDeps): RequestImportUseCase => {
  const publish = async (record: ImportRecord, correlationId: string): Promise<void> => {
    try {
      await deps.publisher.publish({
        importId: record.id,
        walletId: record.walletId,
        sourceType: record.sourceType,
        payloadRef: record.payloadRef,
        correlationId,
      });
    } catch (cause: unknown) {
      // Typed rather than propagated raw, because the caller needs to be told the specific thing
      // that happened: the import is durable, it has this id, and retrying the request with the
      // same key is what will queue it.
      throw new JobPublicationError('Import was recorded but could not be queued', {
        importId: record.id,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const reuse = async (
    existing: ImportRecord,
    command: RequestImportCommand,
  ): Promise<RequestImportResult> => {
    if (existing.requestFingerprint !== command.requestFingerprint) {
      throw new ConflictError(
        'This idempotency key was already used for a different request',
        { idempotencyKey: command.idempotencyKey, importId: existing.id },
      );
    }

    // Still queued from a previous call, or never queued at all because the publish failed. There
    // is no way to tell the two apart, and no need to: processing is idempotent, so republishing
    // costs one redundant message in the first case and rescues the import in the second.
    if (existing.status === 'pending') {
      await publish(existing, command.correlationId);
    }

    return { record: existing, created: false };
  };

  return {
    execute: async (command) => {
      const wallet = await deps.wallets.findById(command.walletId);
      if (wallet === null || wallet.userId !== command.userId) {
        // Deliberately not distinguishing "does not exist" from "belongs to someone else".
        throw new NotFoundError('Wallet not found', { walletId: command.walletId });
      }

      const existing = await deps.imports.findByIdempotencyKey(
        command.userId,
        command.idempotencyKey,
      );
      if (existing !== null) {
        return reuse(existing, command);
      }

      const record = createImport({
        id: ImportId(deps.ids.newId()),
        userId: command.userId,
        walletId: wallet.id,
        // Taken from the wallet rather than the request: the wallet is the single authority on
        // which source its data comes from, so the two cannot drift.
        sourceType: wallet.sourceType,
        payloadRef: command.payloadRef,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        createdAt: deps.clock.now(),
      });

      const stored = await deps.imports.create(record);
      // Two concurrent requests with the same key: the loser sees `created: false` and takes the
      // same path as a sequential retry.
      if (!stored.created) {
        return reuse(stored.record, command);
      }

      await publish(stored.record, command.correlationId);
      return { record: stored.record, created: true };
    },
  };
};
