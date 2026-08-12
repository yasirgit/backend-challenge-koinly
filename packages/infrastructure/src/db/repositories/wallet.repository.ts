import type { WalletRepository } from '@app/application';
import type { SourceType, UserId, Wallet, WalletId } from '@app/domain';

import type { AppDatabase } from '../client.js';
import { toWallet } from './mappers.js';

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly db: AppDatabase) {}

  async findById(id: WalletId): Promise<Wallet | null> {
    const row = await this.db
      .selectFrom('wallets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toWallet(row);
  }

  async findByIdentity(
    userId: UserId,
    sourceType: SourceType,
    sourceAccountRef: string,
  ): Promise<Wallet | null> {
    const row = await this.db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .where('source_type', '=', sourceType)
      .where('source_account_ref', '=', sourceAccountRef)
      .executeTakeFirst();

    return row === undefined ? null : toWallet(row);
  }

  /**
   * Registering the same wallet twice is a no-op rather than an error. The insert races against
   * itself safely: whoever loses the unique constraint reads back the winner's row, so two
   * concurrent registrations both succeed and both see the same wallet.
   */
  async create(wallet: Wallet): Promise<{ wallet: Wallet; created: boolean }> {
    const inserted = await this.db
      .insertInto('wallets')
      .values({
        id: wallet.id,
        user_id: wallet.userId,
        source_type: wallet.sourceType,
        source_account_ref: wallet.sourceAccountRef,
        label: wallet.label,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'source_type', 'source_account_ref']).doNothing(),
      )
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) {
      return { wallet: toWallet(inserted), created: true };
    }

    const existing = await this.findByIdentity(
      wallet.userId,
      wallet.sourceType,
      wallet.sourceAccountRef,
    );
    if (existing === null) {
      // The conflicting row disappeared between the insert and the read. Nothing deletes wallets in
      // this system, so this would mean something is very wrong; failing loudly beats guessing.
      throw new Error('Wallet insert conflicted but the conflicting row could not be read');
    }
    return { wallet: existing, created: false };
  }
}
