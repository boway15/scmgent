import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupeStockAlertIncoming,
  diffStockAlertWrites,
  planStaleStockAlertResolve,
  regionNetworkEffectiveBySku,
  shouldPersistHorizonAlert,
  stockAlertFingerprint,
  stockAlertIntegerQty,
} from './stock-alert-sync.js';

describe('stock-alert-sync', () => {
  it('drops coverage_short on green decision health', () => {
    assert.equal(shouldPersistHorizonAlert('coverage_short', 'green'), false);
    assert.equal(shouldPersistHorizonAlert('coverage_short', 'yellow'), true);
    assert.equal(shouldPersistHorizonAlert('overstock', 'blue'), true);
    assert.equal(shouldPersistHorizonAlert('overstock', 'green'), false);
  });

  it('dedupes incoming by fingerprint keeping the last row', () => {
    const rows = dedupeStockAlertIncoming([
      {
        skuId: 's1',
        warehouseCode: 'EU',
        alertType: 'below_rop',
        currentQty: 1,
        safetyQty: 10,
      },
      {
        skuId: 's1',
        warehouseCode: 'EU',
        alertType: 'below_rop',
        currentQty: 2,
        safetyQty: 10,
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.currentQty, 2);
  });

  it('rounds fractional timeline balances for integer columns', () => {
    assert.equal(stockAlertIntegerQty(-14.095057425742596), -14);
    assert.equal(stockAlertIntegerQty(Number.POSITIVE_INFINITY), 0);
  });

  it('builds stable fingerprints including null warehouse / horizon', () => {
    assert.equal(
      stockAlertFingerprint({
        skuId: 's1',
        warehouseCode: 'EU',
        alertType: 'stockout_horizon',
        horizonDays: 30,
      }),
      's1::EU::stockout_horizon::30',
    );
    assert.equal(
      stockAlertFingerprint({
        skuId: 's1',
        warehouseCode: null,
        alertType: 'coverage_short',
        horizonDays: null,
      }),
      's1::::coverage_short::',
    );
  });

  it('keeps open alerts that are still active this scan', () => {
    const fp = stockAlertFingerprint({
      skuId: 's1',
      warehouseCode: 'EU',
      alertType: 'coverage_short',
    });
    const stale = planStaleStockAlertResolve({
      openAlerts: [{ id: 'a1', fingerprint: fp }],
      activeFingerprints: new Set([fp]),
    });
    assert.deepEqual(stale, []);
  });

  it('auto-resolves open alerts that disappeared this scan', () => {
    const stale = planStaleStockAlertResolve({
      openAlerts: [
        {
          id: 'old',
          fingerprint: stockAlertFingerprint({
            skuId: 's1',
            warehouseCode: 'EU',
            alertType: 'stockout_horizon',
            horizonDays: 7,
          }),
        },
        {
          id: 'keep',
          fingerprint: stockAlertFingerprint({
            skuId: 's1',
            warehouseCode: 'EU',
            alertType: 'coverage_short',
          }),
        },
      ],
      activeFingerprints: [
        stockAlertFingerprint({
          skuId: 's1',
          warehouseCode: 'EU',
          alertType: 'coverage_short',
        }),
      ],
    });
    assert.deepEqual(stale, ['old']);
  });

  it('refreshes an open alert and inserts a new fingerprint once', () => {
    const diff = diffStockAlertWrites({
      openAlerts: [
        {
          id: 'open-1',
          skuId: 's1',
          warehouseCode: 'EU',
          alertType: 'below_rop',
          horizonDays: null,
          projectedQty: 4,
          projectedStockoutDate: '2026-10-01',
        },
      ],
      incoming: [
        {
          skuId: 's1',
          warehouseCode: 'EU',
          alertType: 'below_rop',
          currentQty: 1,
          safetyQty: 8,
        },
        {
          skuId: 's1',
          warehouseCode: 'EU',
          alertType: 'stockout_horizon',
          currentQty: 0,
          safetyQty: 0,
          horizonDays: 7,
          projectedQty: 0,
          projectedStockoutDate: null,
        },
        {
          skuId: 's1',
          warehouseCode: 'EU',
          alertType: 'stockout_horizon',
          currentQty: 0,
          safetyQty: 0,
          horizonDays: 7,
          projectedQty: -1,
          projectedStockoutDate: '2026-10-02',
        },
      ],
    });
    assert.equal(diff.inserts.length, 1);
    assert.equal(diff.inserts[0]?.horizonDays, 7);
    assert.equal(diff.updates.length, 1);
    assert.equal(diff.updates[0]?.id, 'open-1');
    assert.equal(diff.updates[0]?.currentQty, 1);
    assert.equal(diff.updates[0]?.projectedQty, 4);
    assert.equal(diff.updates[0]?.projectedStockoutDate, '2026-10-01');
    assert.equal(diff.activeFingerprints.size, 2);
  });

  it('adds in-production qty once for a US network', () => {
    const totals = regionNetworkEffectiveBySku({
      rows: [
        { skuId: 's1', regionGroup: 'US', effectiveQty: 10, qtyInProduction: 0 },
        { skuId: 's1', regionGroup: 'US', effectiveQty: 5, qtyInProduction: 0 },
        { skuId: 's1', regionGroup: 'EU', effectiveQty: 99, qtyInProduction: 0 },
      ],
      regionGroup: 'US',
      productionQtyBySku: new Map([['s1', 7]]),
    });
    assert.equal(totals.get('s1'), 22);
  });

  it('resolves everything when this scan has no active alerts', () => {
    const stale = planStaleStockAlertResolve({
      openAlerts: [
        { id: 'a', fingerprint: 'x' },
        { id: 'b', fingerprint: 'y' },
      ],
      activeFingerprints: [],
    });
    assert.deepEqual(stale, ['a', 'b']);
  });
});
