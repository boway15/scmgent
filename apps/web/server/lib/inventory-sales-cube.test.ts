import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCubeRowsForSku,
  assertNoRunningCube,
  resolveSalesWindowAsOf,
  type BuildCubeRowsForSkuInput,
} from './inventory-sales-cube.js';
import type { ShareParseResult } from './inventory-share-allocation.js';

function makeShare(weights: Array<{ warehouse: string; weight: number }>): ShareParseResult {
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  return {
    method: 'sales_share',
    shareSum: sum,
    shareSumWarning: Math.abs(sum - 1) > 0.05,
    weights: weights.map((w) => ({ warehouse: w.warehouse, weight: w.weight / sum })),
  };
}

const baseInput = (over: Partial<BuildCubeRowsForSkuInput>): BuildCubeRowsForSkuInput => ({
  skuId: 'sku-1',
  skuCode: 'SKU-001',
  productScope: 'goods',
  category: 'Home',
  lifecycle: null,
  salesCountry: 'US',
  share: makeShare([
    { warehouse: 'US-EAST', weight: 0.6 },
    { warehouse: 'US-WEST', weight: 0.4 },
  ]),
  overseasAvailable: 100,
  overseasInTransit: 20,
  nativeByWarehouse: new Map(),
  sales7d: 10,
  sales14d: 20,
  sales30d: 100,
  totalLeadDaysByWarehouse: new Map([
    ['US-EAST', 30],
    ['US-WEST', 30],
  ]),
  defaultTotalLeadDays: 30,
  ...over,
});

describe('buildCubeRowsForSku', () => {
  it('with share: splits rows and sales30d sums to SKU total', () => {
    const rows = buildCubeRowsForSku(baseInput({}));
    assert.equal(rows.length, 2);
    const sum30 = rows.reduce((s, r) => s + (r.sales30d ?? 0), 0);
    assert.equal(sum30, 100);
    const east = rows.find((r) => r.warehouseCode === 'US-EAST')!;
    const west = rows.find((r) => r.warehouseCode === 'US-WEST')!;
    assert.equal(east.shareMethod, 'sales_share');
    assert.equal(west.shareMethod, 'sales_share');
    // effective = (overseas_available * weight) + (overseas_in_transit * weight)
    // EAST: 100*0.6 + 20*0.6 = 60 + 12 = 72
    assert.equal(east.effectiveQty, 72);
    assert.equal(west.effectiveQty, 48);
    // avg_daily_30d = sales30d / 30
    // EAST sales30d ~ 60 -> avg 2; cover = 72/2 = 36 (no stockout risk, lead 30)
    assert.ok(Math.abs((east.sales30d ?? 0) - 60) <= 1);
    assert.ok(Math.abs((west.sales30d ?? 0) - 40) <= 1);
  });

  it('native warehouse takes priority over share allocation', () => {
    const native = new Map([
      ['US-EAST', { qtyAvailable: 50, qtyInTransit: 5, qtyInProduction: 0 }],
    ]);
    const rows = buildCubeRowsForSku(
      baseInput({ nativeByWarehouse: native }),
    );
    const east = rows.find((r) => r.warehouseCode === 'US-EAST')!;
    assert.equal(east.shareMethod, 'native_warehouse');
    assert.equal(east.effectiveQty, 55); // 50 + 5 + 0
    // WEST still allocated from OVERSEAS by share
    const west = rows.find((r) => r.warehouseCode === 'US-WEST')!;
    assert.equal(west.shareMethod, 'sales_share');
  });

  it('no share + overseas>0: single OVERSEAS row with unallocated risk', () => {
    const rows = buildCubeRowsForSku(
      baseInput({
        share: {
          method: 'unallocated',
          shareSum: 0,
          shareSumWarning: false,
          weights: [],
        },
        overseasAvailable: 80,
        overseasInTransit: 0,
      }),
    );
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.warehouseCode, 'OVERSEAS');
    assert.equal(row.shareMethod, 'unallocated');
    assert.equal(row.effectiveQty, 80);
    assert.equal(row.primaryRisk, 'unallocated');
  });

  it('no sales: sales30d/coverDays null', () => {
    const rows = buildCubeRowsForSku(
      baseInput({
        sales7d: 0,
        sales14d: 0,
        sales30d: 0,
      }),
    );
    for (const row of rows) {
      assert.equal(row.sales30d, null);
      assert.equal(row.coverDays, null);
      assert.equal(row.avgDaily30d, null);
      assert.equal(row.sellThrough30d, null);
    }
  });

  it('stockout risk when coverDays <= totalLeadDays', () => {
    // EAST: effective 72, sales30d 60 -> avg 2, cover 36 -> not risk (lead 30)
    // Make lead 40 so cover 36 <= 40 -> stockout
    const rows = buildCubeRowsForSku(
      baseInput({
        totalLeadDaysByWarehouse: new Map([
          ['US-EAST', 40],
          ['US-WEST', 40],
        ]),
        defaultTotalLeadDays: 40,
      }),
    );
    const east = rows.find((r) => r.warehouseCode === 'US-EAST')!;
    assert.equal(east.primaryRisk, 'stockout_risk');
  });

  it('imbalance: peer cover low and high within same SKU', () => {
    const rows = buildCubeRowsForSku(
      baseInput({
        overseasAvailable: 10,
        overseasInTransit: 0,
        sales7d: 1,
        sales14d: 2,
        sales30d: 100,
        nativeByWarehouse: new Map([
          ['US-WEST', { qtyAvailable: 10000, qtyInTransit: 0, qtyInProduction: 0 }],
        ]),
      }),
    );
    // EAST: 10*0.6=6 eff, sales30d 60 -> avg 2, cover 3 <= 30 (low)
    // WEST: native 10000, sales30d 40 -> avg 1.33, cover 7500 >= 180 (high)
    const east = rows.find((r) => r.warehouseCode === 'US-EAST')!;
    const west = rows.find((r) => r.warehouseCode === 'US-WEST')!;
    assert.equal(east.primaryRisk, 'stockout_risk');
    assert.ok(west.coverDays! >= 180);
    // imbalance should be in east's tags (peer-based)
    assert.ok(east.riskTags.includes('imbalance'));
  });
});

describe('assertNoRunningCube', () => {
  it('throws when a running run exists', () => {
    assert.throws(
      () =>
        assertNoRunningCube({
          running: [{ id: 'r1', startedAt: new Date() }],
          force: false,
        }),
      /running/i,
    );
  });

  it('does not throw when force=true', () => {
    assert.doesNotThrow(() =>
      assertNoRunningCube({
        running: [{ id: 'r1', startedAt: new Date() }],
        force: true,
      }),
    );
  });

  it('does not throw when no running', () => {
    assert.doesNotThrow(() =>
      assertNoRunningCube({ running: [], force: false }),
    );
  });
});

describe('resolveSalesWindowAsOf', () => {
  it('ends sales windows 2 days before business date (sync lag)', () => {
    assert.equal(resolveSalesWindowAsOf('2026-11-11'), '2026-11-09');
    assert.equal(resolveSalesWindowAsOf('2026-03-01'), '2026-02-27');
  });
});
