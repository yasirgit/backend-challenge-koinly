import { describe, expect, it } from 'vitest';

import { AmountOutOfRangeError, InvalidValueError } from '../shared/errors.js';
import { Decimal } from './decimal.js';

describe('Decimal', () => {
  it('preserves eighteen decimal places exactly', () => {
    expect(Decimal.from('0.000000000000000001').toString()).toBe('0.000000000000000001');
  });

  it('preserves twenty integer digits exactly', () => {
    expect(Decimal.from('12345678901234567890').toString()).toBe('12345678901234567890');
  });

  it('canonicalizes equal values written differently', () => {
    expect(Decimal.from('1.50').toString()).toBe('1.5');
    expect(Decimal.from('0001.5').toString()).toBe('1.5');
    expect(Decimal.from('-0').toString()).toBe('0');
    expect(Decimal.from(' 1.5 ').toString()).toBe('1.5');
  });

  it('adds without the rounding error a float would introduce', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. This is the entire reason the class exists.
    expect(Decimal.from('0.1').plus(Decimal.from('0.2')).toString()).toBe('0.3');
  });

  it('adds large values without losing significant digits', () => {
    const sum = Decimal.from('12345678901234567890').plus(Decimal.from('0.000000000000000001'));
    expect(sum.toString()).toBe('12345678901234567890.000000000000000001');
  });

  it('rejects a scale that PostgreSQL would silently round away', () => {
    expect(() => Decimal.from('0.0000000000000000001')).toThrow(AmountOutOfRangeError);
  });

  it('rejects a magnitude the column cannot hold', () => {
    expect(() => Decimal.from('123456789012345678901')).toThrow(AmountOutOfRangeError);
  });

  it('rejects anything that is not a plain decimal number', () => {
    for (const bad of ['', 'abc', '1e-9', 'NaN', 'Infinity', '1,5', '0x10', '1.2.3', '+1']) {
      expect(() => Decimal.from(bad), bad).toThrow(InvalidValueError);
    }
  });

  it('serializes to a string so no amount can reach JSON as a number', () => {
    const payload = JSON.stringify({ quantity: Decimal.from('0.1') });
    expect(payload).toBe('{"quantity":"0.1"}');
  });

  it('compares by value', () => {
    expect(Decimal.from('1.50').equals(Decimal.from('1.5'))).toBe(true);
    expect(Decimal.from('1.5').compare(Decimal.from('2'))).toBeLessThan(0);
    expect(Decimal.from('2').compare(Decimal.from('1.5'))).toBeGreaterThan(0);
    expect(Decimal.from('0').isZero()).toBe(true);
    expect(Decimal.from('0.000000000000000001').isPositive()).toBe(true);
    expect(Decimal.from('-1').isNegative()).toBe(true);
  });
});
