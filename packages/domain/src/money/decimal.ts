import { Decimal as BigDecimal } from 'decimal.js';

import { AmountOutOfRangeError, InvalidValueError } from '../shared/errors.js';

/**
 * Storable range, matching the `NUMERIC(38,18)` columns exactly (see ADR-0004).
 *
 * The scale limit is the important one. PostgreSQL does not reject a value with more decimal
 * places than the column declares — it rounds it, silently. A column chosen to prevent precision
 * loss would then be the thing causing it, so the boundary check has to happen here, before the
 * value reaches the driver.
 */
const MAX_PRECISION = 38;
const MAX_SCALE = 18;
const MAX_INTEGER_DIGITS = MAX_PRECISION - MAX_SCALE;

/**
 * A private constructor clone rather than global configuration: decimal.js defaults to 20
 * significant digits, which silently truncates, and mutating the global would reach into any other
 * consumer of the library in the process.
 */
const Big = BigDecimal.clone({
  precision: 60,
  rounding: BigDecimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 60,
});

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

const countIntegerDigits = (digits: string): number => {
  const stripped = digits.replace(/^0+/, '');
  return stripped.length === 0 ? 1 : stripped.length;
};

/**
 * An exact decimal number. Constructed from strings only, compared and serialized as strings, and
 * never convertible to `number` — the whole point is that no value in this system passes through
 * an IEEE-754 double.
 */
export class Decimal {
  readonly #value: InstanceType<typeof Big>;

  private constructor(value: InstanceType<typeof Big>) {
    this.#value = value;
  }

  /**
   * @throws {InvalidValueError} when the text is not a plain decimal number.
   * @throws {AmountOutOfRangeError} when the value would not survive a `NUMERIC(38,18)` round trip.
   */
  static from(text: string): Decimal {
    const trimmed = text.trim();

    // Exponential notation is rejected rather than parsed: `1e-9` in a CSV is far more likely to be
    // a float that leaked out of some upstream system than an intentional value, and quietly
    // accepting it hides the bug.
    if (!PLAIN_DECIMAL.test(trimmed)) {
      throw new InvalidValueError('Amount must be a plain decimal number', { value: text });
    }

    const unsigned = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
    const [integerPart = '', fractionPart = ''] = unsigned.split('.');

    if (fractionPart.length > MAX_SCALE) {
      throw new AmountOutOfRangeError(
        `Amount has ${String(fractionPart.length)} decimal places; at most ${String(MAX_SCALE)} can be stored exactly`,
        { value: text, scale: fractionPart.length, maxScale: MAX_SCALE },
      );
    }

    if (countIntegerDigits(integerPart) > MAX_INTEGER_DIGITS) {
      throw new AmountOutOfRangeError(
        `Amount has more than ${String(MAX_INTEGER_DIGITS)} integer digits`,
        { value: text, maxIntegerDigits: MAX_INTEGER_DIGITS },
      );
    }

    return new Decimal(new Big(trimmed));
  }

  static #zero: Decimal | undefined;

  /**
   * Lazy on purpose, and it must stay that way.
   *
   * `#wrap` refers to `Decimal` from an instance method, which makes TypeScript rewrite every
   * self-reference in this class to an alias variable that it assigns *after* the class body. A
   * static field initializer runs before that assignment, so `static ZERO = Decimal.from('0')`
   * compiles cleanly, passes the esbuild-transpiled test run, and then throws
   * `Cannot read properties of undefined` the moment the tsc-built image starts. A getter defers
   * the lookup until the alias exists.
   */
  static get ZERO(): Decimal {
    Decimal.#zero ??= Decimal.from('0');
    return Decimal.#zero;
  }

  #wrap(value: InstanceType<typeof Big>): Decimal {
    // Re-validating through `from` keeps the range invariant true for derived values too, so an
    // overflow surfaces at the operation that caused it rather than at the insert.
    return Decimal.from(value.toFixed());
  }

  plus(other: Decimal): Decimal {
    return this.#wrap(this.#value.plus(other.#value));
  }

  minus(other: Decimal): Decimal {
    return this.#wrap(this.#value.minus(other.#value));
  }

  negated(): Decimal {
    return this.#wrap(this.#value.negated());
  }

  isPositive(): boolean {
    return this.#value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.#value.lessThan(0);
  }

  isZero(): boolean {
    return this.#value.isZero();
  }

  equals(other: Decimal): boolean {
    return this.#value.equals(other.#value);
  }

  /** Negative when this is smaller, zero when equal, positive when larger. */
  compare(other: Decimal): number {
    return this.#value.comparedTo(other.#value);
  }

  /**
   * The canonical form: plain notation, no exponent, no trailing zeros, no negative zero. This is
   * both what goes into the database and what goes into the external-id hash, so it has to be
   * stable for equal values regardless of how they were written in the source.
   */
  toString(): string {
    return this.#value.isZero() ? '0' : this.#value.toFixed();
  }

  toJSON(): string {
    return this.toString();
  }
}
