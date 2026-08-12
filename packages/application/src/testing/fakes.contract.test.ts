import { AssetId, UserId } from '@app/domain';

import { demoWallet } from './scenario.js';
import {
  FakeImportRepository,
  FakeTransactionRepository,
  FakeWalletRepository,
} from './fakes.js';
import { describeRepositoryContract } from './repository-contract.js';

/**
 * Run one: the fakes. The same suite runs against PostgreSQL in
 * packages/infrastructure/src/db/repositories/postgres.contract.integration.test.ts.
 *
 * This one is in the unit tier because it needs nothing, which is the point — the fast suite
 * proves the substitutes honour the contract, and the slow suite proves the real adapters do.
 */
describeRepositoryContract('in-memory', () => {
  const wallet = demoWallet();
  const wallets = new FakeWalletRepository();
  wallets.items.set(wallet.id, wallet);

  return Promise.resolve({
    subject: {
      wallets,
      imports: new FakeImportRepository(),
      transactions: new FakeTransactionRepository(),
    },
    userId: UserId(wallet.userId),
    wallet,
    assetIds: [AssetId('01900000-0000-7000-8000-0000000000e1')],
  });
});
