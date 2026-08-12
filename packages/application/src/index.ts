/**
 * The application layer: use cases and the ports they depend on.
 *
 * A use case orchestrates domain objects through interfaces it defines itself. It never names a
 * database, a broker or an HTTP framework — that is what makes it runnable in a unit test and what
 * makes the adapters replaceable.
 */

export {
  ApplicationError,
  ConcurrencyError,
  ConflictError,
  DependencyUnavailableError,
  JobPublicationError,
  NotFoundError,
  ValidationError,
  describeError,
  isRetryable,
} from './errors.js';

export type { Clock, IdGenerator } from './ports/system.js';
export type { ImportJobPublisher, ImportRequestedJob } from './ports/messaging.js';
export type { SourceAdapter, SourceRegistry } from './ports/sources.js';
export type {
  AssetResolver,
  ImportRepository,
  SaveTransactionsResult,
  TransactionCursor,
  TransactionPage,
  TransactionPageQuery,
  TransactionRepository,
  WalletRepository,
} from './ports/repositories.js';

export { createRegisterWalletUseCase } from './use-cases/register-wallet.use-case.js';
export type {
  RegisterWalletCommand,
  RegisterWalletDeps,
  RegisterWalletResult,
  RegisterWalletUseCase,
} from './use-cases/register-wallet.use-case.js';

export { createRequestImportUseCase } from './use-cases/request-import.use-case.js';
export type {
  RequestImportCommand,
  RequestImportDeps,
  RequestImportResult,
  RequestImportUseCase,
} from './use-cases/request-import.use-case.js';

export { createProcessImportUseCase } from './use-cases/process-import.use-case.js';
export type {
  ProcessImportCommand,
  ProcessImportDeps,
  ProcessImportOutcome,
  ProcessImportResult,
  ProcessImportUseCase,
} from './use-cases/process-import.use-case.js';

export { createListTransactionsUseCase } from './use-cases/list-transactions.use-case.js';
export type {
  ListTransactionsDeps,
  ListTransactionsQuery,
  ListTransactionsResult,
  ListTransactionsUseCase,
} from './use-cases/list-transactions.use-case.js';

export { createGetImportUseCase } from './use-cases/get-import.use-case.js';
export type { GetImportDeps, GetImportQuery, GetImportUseCase } from './use-cases/get-import.use-case.js';
