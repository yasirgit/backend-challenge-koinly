import { loadDatabaseConfig } from '../config/config.js';
import { createLogger } from '../observability/logger.js';
import { formatError } from '../observability/to-error.js';
import { createDatabase } from './client.js';

/**
 * Demo data for the end-to-end walkthrough in the README.
 *
 * Identifiers are fixed rather than generated so the curl commands in the README are
 * copy-pasteable, and every insert is `on conflict do nothing` so compose can run this on every
 * start without a second run doing anything.
 *
 * The asset registry is seeded here because unknown assets fail an import by design (assumption
 * A6): a tax system that invents assets when it meets an unfamiliar ticker is worse than one that
 * refuses the row and says which symbol it did not recognize.
 */
export const DEMO_USER_ID = '01900000-0000-7000-8000-00000000a001';
export const DEMO_WALLET_ID = '01900000-0000-7000-8000-0000000000d1';
export const DEMO_CHAIN_WALLET_ID = '01900000-0000-7000-8000-0000000000d2';

const ASSETS: readonly {
  id: string;
  symbol: string;
  chain: string;
  contract: string;
  decimals: number;
}[] = [
  { id: '01900000-0000-7000-8000-0000000000e1', symbol: 'ETH', chain: '', contract: '', decimals: 18 },
  { id: '01900000-0000-7000-8000-0000000000b1', symbol: 'BTC', chain: '', contract: '', decimals: 8 },
  { id: '01900000-0000-7000-8000-0000000000c1', symbol: 'USDC', chain: '', contract: '', decimals: 6 },
  { id: '01900000-0000-7000-8000-0000000000c2', symbol: 'USDT', chain: '', contract: '', decimals: 6 },
  { id: '01900000-0000-7000-8000-0000000000f1', symbol: 'SOL', chain: '', contract: '', decimals: 9 },
  {
    // The same ticker on a specific chain, to make the point that a symbol is not an identity:
    // this is a different row from the USDC above, with its own id.
    id: '01900000-0000-7000-8000-0000000000c3',
    symbol: 'USDC',
    chain: 'ethereum',
    contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
  },
  {
    id: '01900000-0000-7000-8000-0000000000e2',
    symbol: 'ETH',
    chain: 'ethereum',
    contract: '',
    decimals: 18,
  },
];

const main = async (): Promise<void> => {
  const config = loadDatabaseConfig();
  const logger = createLogger({ level: config.logLevel, service: 'seed' });
  const database = createDatabase(config.database);

  try {
    await database.db
      .insertInto('users')
      .values({ id: DEMO_USER_ID, external_ref: 'demo-user' })
      .onConflict((oc) => oc.doNothing())
      .execute();

    await database.db
      .insertInto('assets')
      .values(
        ASSETS.map((asset) => ({
          id: asset.id,
          symbol: asset.symbol,
          chain: asset.chain,
          contract_address: asset.contract,
          decimals: asset.decimals,
          is_verified: true,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();

    await database.db
      .insertInto('wallets')
      .values([
        {
          id: DEMO_WALLET_ID,
          user_id: DEMO_USER_ID,
          source_type: 'acme_exchange_csv',
          source_account_ref: 'demo-account',
          label: 'Demo exchange account',
        },
        {
          id: DEMO_CHAIN_WALLET_ID,
          user_id: DEMO_USER_ID,
          source_type: 'fake_chain_json',
          source_account_ref: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
          label: 'Demo on-chain wallet',
        },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    logger.info(
      {
        userId: DEMO_USER_ID,
        walletId: DEMO_WALLET_ID,
        chainWalletId: DEMO_CHAIN_WALLET_ID,
        assets: ASSETS.length,
      },
      'demo data ready',
    );
  } finally {
    await database.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
