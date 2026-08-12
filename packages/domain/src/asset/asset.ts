import type { AssetId } from '../shared/ids.js';
import { InvalidValueError } from '../shared/errors.js';

/**
 * How a source names an asset, before it has been resolved to one we know about. `USDC` exists on
 * a dozen chains and symbols are squattable, so a symbol on its own is not an identity — the chain
 * is part of the reference whenever the source tells us one.
 */
export interface AssetRef {
  readonly symbol: string;
  readonly chain: string | null;
}

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const CHAIN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export const AssetRef = (symbol: string, chain: string | null = null): AssetRef => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalizedSymbol)) {
    throw new InvalidValueError('Asset symbol is not a recognizable ticker', { symbol });
  }

  if (chain === null) {
    return { symbol: normalizedSymbol, chain: null };
  }

  const normalizedChain = chain.trim().toLowerCase();
  if (!CHAIN_PATTERN.test(normalizedChain)) {
    throw new InvalidValueError('Chain is not a recognizable slug', { chain });
  }
  return { symbol: normalizedSymbol, chain: normalizedChain };
};

/**
 * Stable lookup key for a reference. Used both to resolve references against the asset registry
 * and to serialize a leg into the external-id hash, so it must not change casually.
 */
export const assetRefKey = (ref: AssetRef): string => `${ref.symbol}@${ref.chain ?? '-'}`;

export interface Asset {
  readonly id: AssetId;
  readonly symbol: string;
  readonly chain: string | null;
  readonly contractAddress: string | null;
  /**
   * The asset's native precision, kept for provenance and for the eventual base-unit conversion.
   * Quantities are stored as decimals, so nothing depends on this to be interpreted correctly —
   * which is exactly why it is safe to have a value here that a source got wrong.
   */
  readonly decimals: number;
  /** False for assets accepted from a payload but not vetted. Nothing in this slice creates those. */
  readonly isVerified: boolean;
}

export const assetKeyOf = (asset: Asset): string =>
  assetRefKey({ symbol: asset.symbol, chain: asset.chain });
