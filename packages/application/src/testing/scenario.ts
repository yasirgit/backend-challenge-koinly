import {
  AssetId,
  SourceType,
  UserId,
  WalletId,
  createWallet,
  type AssetRef,
  type TransactionDraft,
  type Wallet,
} from '@app/domain';

import type { SourceAdapter } from '../ports/sources.js';
import {
  FakeAssetResolver,
  FakeImportJobPublisher,
  FakeImportRepository,
  FakeSourceRegistry,
  FakeTransactionRepository,
  FakeWalletRepository,
  fixedClock,
  sequentialIds,
} from './fakes.js';

export const USER_ID = UserId('01900000-0000-7000-8000-00000000a001');
export const OTHER_USER_ID = UserId('01900000-0000-7000-8000-00000000a002');
export const WALLET_ID = WalletId('01900000-0000-7000-8000-0000000000d1');
export const SOURCE_TYPE = SourceType('acme_exchange_csv');

export const KNOWN_ASSETS = new Map<string, AssetId>([
  ['ETH@-', AssetId('01900000-0000-7000-8000-0000000000e1')],
  ['USDC@-', AssetId('01900000-0000-7000-8000-0000000000c1')],
  ['BTC@-', AssetId('01900000-0000-7000-8000-0000000000b1')],
]);

export const demoWallet = (): Wallet =>
  createWallet({
    id: WALLET_ID,
    userId: USER_ID,
    sourceType: SOURCE_TYPE,
    sourceAccountRef: 'demo-account',
    label: 'Demo exchange account',
  });

/** A source adapter over a fixed list of drafts, with a hook for simulating read failures. */
export class StubSourceAdapter implements SourceAdapter {
  readonly sourceType = SOURCE_TYPE;
  reads = 0;
  failWith: Error | null = null;

  constructor(private drafts: readonly TransactionDraft[]) {}

  setDrafts(drafts: readonly TransactionDraft[]): void {
    this.drafts = drafts;
  }

  async *read(_payloadRef: string): AsyncIterable<TransactionDraft> {
    this.reads += 1;
    if (this.failWith !== null) {
      throw this.failWith;
    }
    for (const draft of this.drafts) {
      yield await Promise.resolve(draft);
    }
  }
}

export interface Harness {
  readonly wallets: FakeWalletRepository;
  readonly imports: FakeImportRepository;
  readonly transactions: FakeTransactionRepository;
  readonly assets: FakeAssetResolver;
  readonly publisher: FakeImportJobPublisher;
  readonly sources: FakeSourceRegistry;
  readonly adapter: StubSourceAdapter;
  readonly clock: ReturnType<typeof fixedClock>;
  readonly ids: ReturnType<typeof sequentialIds>;
}

export const createHarness = (
  drafts: readonly TransactionDraft[] = [],
  knownAssets: ReadonlyMap<string, AssetId> = KNOWN_ASSETS,
): Harness => {
  const wallets = new FakeWalletRepository();
  wallets.items.set(WALLET_ID, demoWallet());

  const adapter = new StubSourceAdapter(drafts);
  const sources = new FakeSourceRegistry().register(adapter);

  return {
    wallets,
    imports: new FakeImportRepository(),
    transactions: new FakeTransactionRepository(),
    assets: new FakeAssetResolver(knownAssets),
    publisher: new FakeImportJobPublisher(),
    sources,
    adapter,
    clock: fixedClock(),
    ids: sequentialIds(),
  };
};

export const assetRefsIn = (drafts: readonly TransactionDraft[]): readonly AssetRef[] =>
  drafts.flatMap((draft) => draft.legs.map((leg) => leg.asset));
