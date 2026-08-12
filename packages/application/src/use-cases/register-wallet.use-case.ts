import { createWallet, SourceType, WalletId, type UserId, type Wallet } from '@app/domain';

import type { WalletRepository } from '../ports/repositories.js';
import type { IdGenerator } from '../ports/system.js';
import type { SourceRegistry } from '../ports/sources.js';
import { ValidationError } from '../errors.js';

export interface RegisterWalletCommand {
  readonly userId: UserId;
  readonly sourceType: string;
  readonly sourceAccountRef: string;
  readonly label: string | null;
}

export interface RegisterWalletResult {
  readonly wallet: Wallet;
  readonly created: boolean;
}

export interface RegisterWalletDeps {
  readonly wallets: WalletRepository;
  readonly sources: SourceRegistry;
  readonly ids: IdGenerator;
}

export interface RegisterWalletUseCase {
  execute: (command: RegisterWalletCommand) => Promise<RegisterWalletResult>;
}

export const createRegisterWalletUseCase = (deps: RegisterWalletDeps): RegisterWalletUseCase => ({
  execute: async (command) => {
    const sourceType = SourceType(command.sourceType);

    // Rejected here rather than at import time: a wallet pointing at a source nothing can read is
    // a trap that only springs later, when someone tries to use it.
    if (deps.sources.get(sourceType) === null) {
      throw new ValidationError(`Unknown source type: ${command.sourceType}`, {
        sourceType: command.sourceType,
        known: deps.sources.list(),
      });
    }

    const wallet = createWallet({
      id: WalletId(deps.ids.newId()),
      userId: command.userId,
      sourceType,
      sourceAccountRef: command.sourceAccountRef,
      label: command.label,
    });

    return deps.wallets.create(wallet);
  },
});
