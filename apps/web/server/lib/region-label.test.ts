import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSalesRegionLabel } from './region-label.js';

describe('normalizeSalesRegionLabel', () => {
  it('accepts region codes and confirmed Chinese labels', () => {
    assert.equal(normalizeSalesRegionLabel('US'), 'US');
    assert.equal(normalizeSalesRegionLabel('eu'), 'EU');
    assert.equal(normalizeSalesRegionLabel('美国'), 'US');
    assert.equal(normalizeSalesRegionLabel('加拿大'), 'CA');
    assert.equal(normalizeSalesRegionLabel('欧洲'), 'EU');
    assert.equal(normalizeSalesRegionLabel('英国'), 'UK');
    assert.equal(normalizeSalesRegionLabel('墨西哥'), 'MX');
    assert.equal(normalizeSalesRegionLabel('巴西'), 'BR');
  });

  it('does not guess unknown labels', () => {
    assert.equal(normalizeSalesRegionLabel('美区'), null);
    assert.equal(normalizeSalesRegionLabel('Amazon德国'), null);
    assert.equal(normalizeSalesRegionLabel(''), null);
    assert.equal(normalizeSalesRegionLabel(null), null);
  });
});
