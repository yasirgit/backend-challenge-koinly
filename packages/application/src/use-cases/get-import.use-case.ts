import type { ImportId, ImportRecord, UserId } from '@app/domain';

import { NotFoundError } from '../errors.js';
import type { ImportRepository } from '../ports/repositories.js';

export interface GetImportQuery {
  readonly userId: UserId;
  readonly importId: ImportId;
}

export interface GetImportDeps {
  readonly imports: ImportRepository;
}

export interface GetImportUseCase {
  execute: (query: GetImportQuery) => Promise<ImportRecord>;
}

/**
 * How a caller finds out what happened to an import — including the case where it is still
 * `pending` because its job was never queued, which is the visible symptom of the failure window
 * described in ADR-0011.
 */
export const createGetImportUseCase = (deps: GetImportDeps): GetImportUseCase => ({
  execute: async (query) => {
    const record = await deps.imports.findById(query.importId);
    if (record === null || record.userId !== query.userId) {
      throw new NotFoundError('Import not found', { importId: query.importId });
    }
    return record;
  },
});
