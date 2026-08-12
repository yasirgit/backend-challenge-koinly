import type { AssetRef } from '../asset/asset.js';
import type { Decimal } from './decimal.js';

/**
 * A quantity and its unit, travelling together. A bare `Decimal` in a signature is a quantity of
 * something unspecified, which is how you end up adding ETH to USD.
 */
export interface AssetAmount {
  readonly asset: AssetRef;
  readonly quantity: Decimal;
}

export const AssetAmount = (asset: AssetRef, quantity: Decimal): AssetAmount => ({
  asset,
  quantity,
});
