declare const brand: unique symbol;

/**
 * A nominal type over a primitive. `WalletId` and `ImportId` are both strings at runtime, and
 * without branding nothing stops one being passed where the other is expected — the kind of bug
 * that type systems are supposed to catch and that a `type WalletId = string` alias does not.
 */
export type Branded<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};
