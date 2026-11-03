import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecastSkuQuery, splitForecastSkuCodes } from './forecast-sku-query.js';

describe('parseForecastSkuQuery', () => {
  it('treats blank input as no filter', () => {
    assert.deepEqual(parseForecastSkuQuery('  '), { kind: 'none' });
    assert.deepEqual(parseForecastSkuQuery(undefined), { kind: 'none' });
  });

  it('keeps a single token for fuzzy match', () => {
    assert.deepEqual(parseForecastSkuQuery(' 70457 '), { kind: 'fuzzy', token: '70457' });
  });

  it('splits commas, spaces, and newlines into exact codes', () => {
    assert.deepEqual(parseForecastSkuQuery('sku-a, sku-b，SKU-A\nsku-c;sku-d'), {
      kind: 'exact',
      codes: ['SKU-A', 'SKU-B', 'SKU-C', 'SKU-D'],
    });
  });

  it('splits generation codes as exact uppercase tokens', () => {
    assert.deepEqual(splitForecastSkuCodes('  '), []);
    assert.deepEqual(splitForecastSkuCodes(' abc-123 '), ['ABC-123']);
    assert.deepEqual(splitForecastSkuCodes('sku-a, sku-b，SKU-A'), ['SKU-A', 'SKU-B']);
  });
});
