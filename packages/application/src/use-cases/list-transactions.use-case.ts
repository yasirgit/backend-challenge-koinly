import type { Transaction, UserId, WalletId } from '@app/domain';

import { NotFoundError, ValidationError } from '../errors.js';
import type {
  TransactionCursor,
  TransactionRepository,
  WalletRepository,
} from '../ports/repositories.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface ListTransactionsQuery {
  readonly userId: UserId;
  readonly walletId: WalletId;
  readonly limit?: number;
  readonly cursor?: TransactionCursor | null;
}

export interface ListTransactionsResult {
  readonly items: readonly Transaction[];
  /**
   * Structured rather than a string: turning a position into an opaque token is a transport
   * concern, and the API layer is where it belongs.
   */
  readonly nextCursor: TransactionCursor | null;
}

export interface ListTransactionsDeps {
  readonly wallets: WalletRepository;
  readonly transactions: TransactionRepository;
}

export interface ListTransactionsUseCase {
  execute: (query: ListTransactionsQuery) => Promise<ListTransactionsResult>;
}

export const createListTransactionsUseCase = (
  deps: ListTransactionsDeps,
): ListTransactionsUseCase => ({
  execute: async (query) => {
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new ValidationError(`limit must be between 1 and ${String(MAX_LIMIT)}`, { limit });
    }

    const wallet = await deps.wallets.findById(query.walletId);
    if (wallet === null || wallet.userId !== query.userId) {
      throw new NotFoundError('Wallet not found', { walletId: query.walletId });
    }

    return deps.transactions.listByWallet({
      walletId: query.walletId,
      limit,
      cursor: query.cursor ?? null,
    });
  },
});
