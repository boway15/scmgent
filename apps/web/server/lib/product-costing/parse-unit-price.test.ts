import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUnitPrice } from './parse-unit-price.js';

describe('parseUnitPrice', () => {
  it('accepts numbers and non-empty numeric strings', () => {
    assert.equal(parseUnitPrice(0), 0);
    assert.equal(parseUnitPrice(12.5), 12.5);
    assert.equal(parseUnitPrice('0'), 0);
    assert.equal(parseUnitPrice('  12.25  '), 12.25);
  });

  it('rejects empty, null, and undefined', () => {
    assert.equal(parseUnitPrice(null), null);
    assert.equal(parseUnitPrice(undefined), null);
    assert.equal(parseUnitPrice(''), null);
    assert.equal(parseUnitPrice('   '), null);
  });

  it('rejects invalid or negative values', () => {
    assert.equal(parseUnitPrice(-1), null);
    assert.equal(parseUnitPrice('-0.01'), null);
    assert.equal(parseUnitPrice('abc'), null);
    assert.equal(parseUnitPrice(Number.NaN), null);
    assert.equal(parseUnitPrice(Number.POSITIVE_INFINITY), null);
    assert.equal(parseUnitPrice(true), null);
  });
});
