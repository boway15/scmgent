import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collapseSkuReplenishmentCandidates } from './network-replenishment.js';

describe('collapseSkuReplenishmentCandidates', () => {
  it('returns null for empty input', () => {
    assert.equal(collapseSkuReplenishmentCandidates([]), null);
  });

  it('uses max suggested qty across warehouses instead of summing', () => {
    const base = {
      skuId: 'sku-1',
      skuCode: 'SKU-1',
      spuId: null,
      replenishLight: 'green',
      suggestedDate: '2026-10-01',
      reason: '缺口',
      healthStatus: 'red' as const,
      coverageDays: 5,
      totalLeadDays: 60,
      latestOrderDays: 10,
      metrics: {},
    };

    const collapsed = collapseSkuReplenishmentCandidates([
      { ...base, warehouseCode: 'US-WEST', suggestedQty: 500 },
      { ...base, warehouseCode: 'US-EAST', suggestedQty: 480, suggestedDate: '2026-09-28' },
    ]);

    assert.ok(collapsed);
    assert.equal(collapsed!.warehouseCode, null);
    assert.equal(collapsed!.suggestedQty, 500);
    assert.equal(collapsed!.suggestedDate, '2026-09-28');
    assert.equal(collapsed!.metrics.networkCollapsed, true);
    assert.deepEqual(collapsed!.metrics.triggerWarehouses, ['US-EAST', 'US-WEST']);
  });

  it('prefers network timeline override over per-warehouse max qty', () => {
    const base = {
      skuId: 'sku-3',
      skuCode: 'SKU-3',
      spuId: null,
      replenishLight: 'green',
      reason: '缺口',
      healthStatus: 'red' as const,
      coverageDays: 5,
      totalLeadDays: 60,
      latestOrderDays: 10,
      metrics: {},
    };

    const collapsed = collapseSkuReplenishmentCandidates(
      [
        { ...base, warehouseCode: 'US-WEST', suggestedQty: 500, suggestedDate: '2026-10-01' },
        { ...base, warehouseCode: 'US-EAST', suggestedQty: 480, suggestedDate: '2026-09-28' },
      ],
      {
        suggestedQty: 420,
        suggestedDate: '2026-09-20',
        totalLeadDays: 55,
        stockoutDate: '2026-11-01',
      },
    );

    assert.ok(collapsed);
    assert.equal(collapsed!.suggestedQty, 420);
    assert.equal(collapsed!.suggestedDate, '2026-09-20');
    assert.equal(collapsed!.totalLeadDays, 55);
    assert.equal(collapsed!.metrics.networkTimeline, true);
    assert.match(String(collapsed!.reason), /网络时间轴/);
  });

  it('keeps single-warehouse candidate as network row', () => {
    const collapsed = collapseSkuReplenishmentCandidates([
      {
        skuId: 'sku-2',
        skuCode: 'SKU-2',
        spuId: null,
        replenishLight: 'green',
        warehouseCode: 'US-WEST',
        suggestedQty: 120,
        suggestedDate: '2026-10-05',
        reason: '西仓缺货',
        healthStatus: 'yellow',
        coverageDays: 12,
        totalLeadDays: 55,
        latestOrderDays: 8,
        metrics: {},
      },
    ]);

    assert.ok(collapsed);
    assert.equal(collapsed!.warehouseCode, null);
    assert.equal(collapsed!.suggestedQty, 120);
    assert.match(String(collapsed!.reason), /网络口径/);
  });
});
