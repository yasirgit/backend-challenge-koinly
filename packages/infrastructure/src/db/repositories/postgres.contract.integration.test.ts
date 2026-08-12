import { describeRepositoryContract } from '@app/application/testing';
import { AssetId, SourceType, UserId, WalletId, createWallet } from '@app/domain';
import { uuidv7 } from 'uuidv7';

import { connectTestDatabase } from '../../testing/test-database.js';
import { PostgresImportRepository } from './import.repository.js';
import { PostgresTransactionRepository } from './transaction.repository.js';
import { PostgresWalletRepository } from './wallet.repository.js';

/**
 * Run two: the real adapters, against a migrated PostgreSQL.
 *
 * Every test scopes itself to a freshly created user and wallet rather than truncating tables, so
 * suites can share one database without racing and a failure leaves its evidence intact.
 */
describeRepositoryContract('postgres', async () => {
  const database = await connectTestDatabase();

  const userId = UserId(uuidv7());
  const assetId = AssetId(uuidv7());

  await database.db
    .insertInto('users')
    .values({ id: userId, external_ref: `contract-${userId}` })
    .execute();

  await database.db
    .insertInto('assets')
    .values({
      id: assetId,
      symbol: 'ETH',
      // The tail, not the head: a UUIDv7 begins with a timestamp, so two runs a few seconds apart
      // share their first eight characters and would collide on the asset identity key.
      chain: `test-${userId.slice(-12)}`,
      contract_address: '',
      decimals: 18,
      is_verified: true,
    })
    .execute();

  const wallet = createWallet({
    id: WalletId(uuidv7()),
    userId,
    sourceType: SourceType('acme_exchange_csv'),
    sourceAccountRef: `contract-account-${userId.slice(-12)}`,
    label: 'Contract test wallet',
  });

  const wallets = new PostgresWalletRepository(database.db);
  await wallets.create(wallet);

  return {
    subject: {
      wallets,
      imports: new PostgresImportRepository(database.db),
      transactions: new PostgresTransactionRepository(database.db),
    },
    userId,
    wallet,
    assetIds: [assetId],
    dispose: database.close,
  };
});
