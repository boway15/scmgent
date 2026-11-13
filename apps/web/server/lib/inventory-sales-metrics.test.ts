import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateSalesWindows,
  calcCoverDays,
  calcSellThrough30d,
  buildRiskTags,
  coverBandFromDays,
} from './inventory-sales-metrics.js';
import type { ShareParseResult } from './inventory-share-allocation.js';

const share: ShareParseResult = {
  method: 'sales_share',
  shareSum: 1,
  shareSumWarning: false,
  weights: [
    { warehouse: 'US-EAST', weight: 0.6 },
    { warehouse: 'US-WEST', weight: 0.4 },
  ],
};

describe('inventory-sales-metrics', () => {
  it('allocates sales windows by share and preserves sum', () => {
    const map = allocateSalesWindows({
      sales7d: 10,
      sales14d: 20,
      sales30d: 100,
      share,
    });
    const east = map.get('US-EAST')!;
    const west = map.get('US-WEST')!;
    assert.equal(east.sales30d + west.sales30d, 100);
    assert.equal(east.sales7d + west.sales7d, 10);
    assert.ok(Math.abs(east.shareWeight - 0.6) < 1e-9);
  });

  it('returns empty map when unallocated', () => {
    const map = allocateSalesWindows({
      sales7d: 10,
      sales14d: 20,
      sales30d: 100,
      share: { method: 'unallocated', shareSum: 0, shareSumWarning: false, weights: [] },
    });
    assert.equal(map.size, 0);
  });

  it('cover and sell-through null on zero demand / zero denom', () => {
    assert.equal(calcCoverDays(100, 0), null);
    assert.equal(calcCoverDays(100, 10), 10);
    assert.equal(calcSellThrough30d(0, 0), null);
    assert.equal(calcSellThrough30d(30, 70), 0.3);
  });

  it('risk priority stockout > slow > imbalance > unallocated', () => {
    const r1 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 10,
      coverDays: 5,
      avgDaily30d: 2,
      totalLeadDays: 30,
      peerCoverDays: [5, 200],
    });
    assert.equal(r1.primaryRisk, 'stockout_risk');

    const r2 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 100,
      coverDays: 120,
      avgDaily30d: 0.05,
      totalLeadDays: 30,
      peerCoverDays: [120],
    });
    assert.equal(r2.primaryRisk, 'slow_moving');

    const r3 = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 50,
      coverDays: 20,
      avgDaily30d: 2,
      totalLeadDays: 30,
      peerCoverDays: [20, 200],
      overstockThresholdDays: 180,
    });
    assert.ok(r3.tags.includes('imbalance'));
    assert.equal(r3.primaryRisk, 'stockout_risk'); // 20 ≤ 30

    const r4 = buildRiskTags({
      shareMethod: 'unallocated',
      effectiveQty: 80,
      coverDays: null,
      avgDaily30d: 0,
      totalLeadDays: 30,
      peerCoverDays: [null],
    });
    assert.equal(r4.primaryRisk, 'unallocated');
  });

  it('imbalance includes current row cover when peers exclude self', () => {
    const r = buildRiskTags({
      shareMethod: 'sales_share',
      effectiveQty: 50,
      coverDays: 20,
      avgDaily30d: 2,
      totalLeadDays: 30,
      peerCoverDays: [200],
      overstockThresholdDays: 180,
    });
    assert.ok(r.tags.includes('imbalance'));
    assert.equal(r.primaryRisk, 'stockout_risk');
  });

  it('maps cover days into fixed command-center bands', () => {
    assert.equal(coverBandFromDays(null), 'no_velocity');
    assert.equal(coverBandFromDays(0), 'd0_14');
    assert.equal(coverBandFromDays(14), 'd0_14');
    assert.equal(coverBandFromDays(15), 'd15_30');
    assert.equal(coverBandFromDays(30), 'd15_30');
    assert.equal(coverBandFromDays(31), 'd31_90');
    assert.equal(coverBandFromDays(90), 'd31_90');
    assert.equal(coverBandFromDays(91), 'd90_plus');
  });
});
