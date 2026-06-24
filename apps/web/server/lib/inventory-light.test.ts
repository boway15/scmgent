import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcInventoryHealth,
  estimateInventoryHealthQuick,
  isGrayLifecycle,
  isSlowMovingStock,
  normalizeInventoryHealth,
} from './inventory-light.js';

describe('inventory-light', () => {
  it('normalizes legacy health values', () => {
    assert.equal(normalizeInventoryHealth('healthy'), 'green');
    assert.equal(normalizeInventoryHealth('overstock'), 'blue');
  });

  it('detects gray lifecycle keywords', () => {
    assert.equal(isGrayLifecycle('即将停售'), true);
    assert.equal(isGrayLifecycle('成熟期'), false);
  });

  it('detects slow-moving stock', () => {
    assert.equal(
      isSlowMovingStock({ effectiveQty: 500, avgDaily: 0.05, coverageDays: 120 }),
      true,
    );
    assert.equal(
      isSlowMovingStock({ effectiveQty: 500, avgDaily: 2, coverageDays: 120 }),
      false,
    );
  });

  it('prioritizes gray over red', () => {
    assert.equal(
      calcInventoryHealth({
        coverageDays: 10,
        totalLeadDays: 102,
        safetyStockDays: 14,
        overstockThresholdDays: 180,
        lifecycle: '滞销',
      }),
      'gray',
    );
  });

  it('estimates health from ROP ratio', () => {
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 300, reorderPoint: 100 }), 'blue');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 50, reorderPoint: 100 }), 'red');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 110, reorderPoint: 100 }), 'yellow');
    assert.equal(estimateInventoryHealthQuick({ effectiveQty: 200, reorderPoint: 100 }), 'green');
  });
});
