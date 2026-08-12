import { InvalidValueError } from '../shared/errors.js';
import type { SourceType, UserId, WalletId } from '../shared/ids.js';

/**
 * An account at a source: an exchange account or an on-chain address. Transactions belong to a
 * wallet and balances are computed over one, so it is the unit of ownership in this slice.
 */
export interface Wallet {
  readonly id: WalletId;
  readonly userId: UserId;
  readonly sourceType: SourceType;
  /**
   * How the source identifies this account: an address, an account number, an API key label. Opaque
   * to us, but part of the wallet's identity — `(userId, sourceType, sourceAccountRef)` is unique.
   */
  readonly sourceAccountRef: string;
  readonly label: string;
}

export interface CreateWalletProps {
  readonly id: WalletId;
  readonly userId: UserId;
  readonly sourceType: SourceType;
  readonly sourceAccountRef: string;
  readonly label: string | null;
}

export const createWallet = (props: CreateWalletProps): Wallet => {
  const sourceAccountRef = props.sourceAccountRef.trim();
  if (sourceAccountRef.length === 0 || sourceAccountRef.length > 255) {
    throw new InvalidValueError('Wallet source account reference must be 1 to 255 characters', {
      sourceAccountRef: props.sourceAccountRef,
    });
  }

  const label = (props.label ?? '').trim();
  return {
    id: props.id,
    userId: props.userId,
    sourceType: props.sourceType,
    sourceAccountRef,
    label: label.length > 0 ? label : `${props.sourceType}:${sourceAccountRef}`,
  };
};
