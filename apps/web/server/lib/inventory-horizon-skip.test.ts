import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildHorizonSkipAllocation,
  parseSharesFromSnapshot,
  shouldSkipConfirmedHorizon,
} from './inventory-share-allocation.js';
import {
  deriveHorizonAlerts,
  filterSkippedConfirmedHorizonAlerts,
} from './inventory-horizon-alerts.js';

describe('confirmed horizon skip', () => {
  it('skips confirmed horizons when allocation is unallocated', () => {
    assert.equal(shouldSkipConfirmedHorizon('unallocated'), true);
    assert.equal(shouldSkipConfirmedHorizon('sales_share'), false);
    assert.equal(shouldSkipConfirmedHorizon('native_warehouse'), false);
  });

  it('drops stockout_horizon and uncoverable_by_new_po but keeps coverage_short and overstock', () => {
    const candidates = [
      ...deriveHorizonAlerts({
        points: [
          { horizonDays: 0, projectedBalance: 10 },
          { horizonDays: 7, projectedBalance: -1 },
          { horizonDays: 15, projectedBalance: -20 },
          { horizonDays: 30, projectedBalance: -40 },
        ],
        coverageDays: 40,
        totalLeadDays: 60,
        overstockThresholdDays: 180,
        stockoutDate: '2026-10-01',
        uncoverableByNewPo: true,
      }),
      ...deriveHorizonAlerts({
        points: [{ horizonDays: 0, projectedBalance: 5000 }],
        coverageDays: 200,
        totalLeadDays: 60,
        overstockThresholdDays: 180,
        stockoutDate: null,
      }),
    ];
    const filtered = filterSkippedConfirmedHorizonAlerts(candidates, true);
    const types = [...new Set(filtered.map((row) => row.alertType))].sort();
    assert.deepEqual(types, ['coverage_short', 'overstock']);
  });

  /**
   * Horizon skip must use inventory_records OVERSEAS qtyAvailable
   * (getLatestInventorySnapshot(skuId, 'OVERSEAS')), not 海外仓在库 from
   * the turnover snapshot. resolvePlanningAllocation already covers the
   * method table; this helper is what stockAlert should pass records qty into.
   */
  it('unallocated share + native 0 + records overseasTotal 100 skips confirmed horizon', () => {
    const share = parseSharesFromSnapshot({});
    assert.equal(share.method, 'unallocated');
    const result = buildHorizonSkipAllocation({
      share,
      nativeQty: 0,
      overseasRecordsQty: 100,
    });
    assert.equal(result.method, 'unallocated');
    assert.equal(result.shouldSkip, true);
  });
});
