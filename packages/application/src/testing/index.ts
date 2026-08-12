/**
 * Test doubles and the repository contract, published as a separate entrypoint
 * (`@app/application/testing`).
 *
 * Shipping the fakes alongside the ports is deliberate: whoever defines an interface is best
 * placed to provide a working substitute for it, and keeping them together means the fake and the
 * contract move when the port does.
 */

export {
  FakeAssetResolver,
  FakeImportJobPublisher,
  FakeImportRepository,
  FakeSourceRegistry,
  FakeTransactionRepository,
  FakeWalletRepository,
  fixedClock,
  sequentialIds,
} from './fakes.js';

export { describeRepositoryContract } from './repository-contract.js';
export type {
  RepositoryContractFixture,
  RepositoryContractSubject,
} from './repository-contract.js';

export {
  KNOWN_ASSETS,
  OTHER_USER_ID,
  SOURCE_TYPE,
  StubSourceAdapter,
  USER_ID,
  WALLET_ID,
  assetRefsIn,
  createHarness,
  demoWallet,
} from './scenario.js';
export type { Harness } from './scenario.js';
