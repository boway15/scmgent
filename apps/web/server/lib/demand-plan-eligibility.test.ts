import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  excludedCrossGroupSpuIds,
  isSkuWarehouseInPilot,
} from './demand-plan-eligibility.js';

const config = {
  enabled: true,
  projectGroups: ['项目6组'],
  warehouses: ['US-WEST'],
};

describe('demand-plan-eligibility', () => {
  it('excludes SPUs that span two project groups', () => {
    const excluded = excludedCrossGroupSpuIds([
      { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
      { skuId: 'b', projectGroup: '项目1组', spuId: 'spu1', isActive: true },
    ]);
    assert.equal(excluded.has('spu1'), true);
  });

  it('does not exclude SPU fully inside one group', () => {
    const excluded = excludedCrossGroupSpuIds([
      { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
      { skuId: 'b', projectGroup: '项目6组', spuId: 'spu1', isActive: true },
    ]);
    assert.equal(excluded.has('spu1'), false);
  });

  it('hits only matching group and warehouse when enabled', () => {
    const sku = { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true };
    assert.equal(
      isSkuWarehouseInPilot({ sku, warehouseCode: 'US-WEST', config, excludedSpuIds: new Set() }),
      true,
    );
    assert.equal(
      isSkuWarehouseInPilot({ sku, warehouseCode: 'US-EAST', config, excludedSpuIds: new Set() }),
      false,
    );
  });

  it('misses when disabled or SPU excluded', () => {
    const sku = { skuId: 'a', projectGroup: '项目6组', spuId: 'spu1', isActive: true };
    assert.equal(
      isSkuWarehouseInPilot({
        sku,
        warehouseCode: 'US-WEST',
        config: { ...config, enabled: false },
        excludedSpuIds: new Set(),
      }),
      false,
    );
    assert.equal(
      isSkuWarehouseInPilot({
        sku,
        warehouseCode: 'US-WEST',
        config,
        excludedSpuIds: new Set(['spu1']),
      }),
      false,
    );
  });
});
