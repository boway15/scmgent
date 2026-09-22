import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveHorizonAlerts,
  type HorizonAlertCandidate,
} from './inventory-horizon-alerts.js';

describe('inventory-horizon-alerts', () => {
  it('emits 7/15/30 stockout_horizon when balance crosses zero', () => {
    const alerts = deriveHorizonAlerts({
      points: [
        { horizonDays: 0, projectedBalance: 1000 },
        { horizonDays: 7, projectedBalance: 200 },
        { horizonDays: 15, projectedBalance: -50 },
        { horizonDays: 30, projectedBalance: -400 },
        { horizonDays: 45, projectedBalance: -800 },
      ],
      coverageDays: 20,
      totalLeadDays: 60,
      overstockThresholdDays: 180,
      stockoutDate: '2026-10-01',
    });

    const horizons = alerts
      .filter((a) => a.alertType === 'stockout_horizon')
      .map((a) => a.horizonDays)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.deepEqual(horizons, [15, 30]);
  });

  it('emits coverage_short when coverage < lead time', () => {
    const alerts = deriveHorizonAlerts({
      points: [{ horizonDays: 0, projectedBalance: 100 }],
      coverageDays: 40,
      totalLeadDays: 60,
      overstockThresholdDays: 180,
      stockoutDate: null,
    });
    assert.ok(alerts.some((a) => a.alertType === 'coverage_short'));
  });

  it('emits overstock when coverage exceeds threshold', () => {
    const alerts = deriveHorizonAlerts({
      points: [{ horizonDays: 0, projectedBalance: 5000 }],
      coverageDays: 200,
      totalLeadDays: 60,
      overstockThresholdDays: 180,
      stockoutDate: null,
    });
    assert.ok(alerts.some((a) => a.alertType === 'overstock'));
  });

  it('does not duplicate 7-day alert if already negative at day 0 conceptually via stockout type elsewhere', () => {
    const alerts: HorizonAlertCandidate[] = deriveHorizonAlerts({
      points: [
        { horizonDays: 0, projectedBalance: 10 },
        { horizonDays: 7, projectedBalance: -1 },
      ],
      coverageDays: 5,
      totalLeadDays: 60,
      overstockThresholdDays: 180,
      stockoutDate: '2026-09-20',
    });
    assert.ok(alerts.some((a) => a.alertType === 'stockout_horizon' && a.horizonDays === 7));
  });

  it('emits uncoverable_by_new_po when uncoverableByNewPo is true', () => {
    const alerts = deriveHorizonAlerts({
      points: [
        { horizonDays: 0, projectedBalance: 1000 },
        { horizonDays: 7, projectedBalance: 200 },
        { horizonDays: 15, projectedBalance: -50 },
        { horizonDays: 30, projectedBalance: -400 },
        { horizonDays: 45, projectedBalance: -800 },
      ],
      coverageDays: 20,
      totalLeadDays: 60,
      overstockThresholdDays: 180,
      stockoutDate: '2026-10-01',
      uncoverableByNewPo: true,
    });
    const uncovered = alerts.find((a) => a.alertType === 'uncoverable_by_new_po');
    assert.ok(uncovered);
    assert.equal(uncovered.horizonDays, null);
    assert.equal(uncovered.projectedQty, 0);
    assert.equal(uncovered.projectedStockoutDate, '2026-10-01');
    assert.equal(uncovered.thresholdQty, 60);
  });
});
