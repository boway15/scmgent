import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateWorstHealthBySku,
  healthToReplenishLight,
  isReplenishLightManualLocked,
  markReplenishLightManual,
} from './replenish-light-sync.js';

describe('replenish-light-sync', () => {
  it('maps health to replenish light', () => {
    assert.equal(healthToReplenishLight('red'), 'red');
    assert.equal(healthToReplenishLight('yellow'), 'yellow');
    assert.equal(healthToReplenishLight('green'), 'green');
    assert.equal(healthToReplenishLight('blue'), 'green');
    assert.equal(healthToReplenishLight('gray'), 'green');
  });

  it('picks worst health across warehouses for one SKU', () => {
    const map = aggregateWorstHealthBySku([
      { skuId: 'a', healthStatus: 'green' },
      { skuId: 'a', healthStatus: 'yellow' },
      { skuId: 'b', healthStatus: 'blue' },
    ]);
    assert.equal(map.get('a'), 'yellow');
    assert.equal(map.get('b'), 'blue');
  });

  it('tracks manual replenish light lock in encoding meta', () => {
    assert.equal(isReplenishLightManualLocked(null), false);
    const marked = markReplenishLightManual({ turnoverSnapshot: {} });
    assert.equal(marked.replenishLightManual, true);
    assert.equal(isReplenishLightManualLocked(marked), true);
  });
});
