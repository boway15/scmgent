import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlanningDashboardCards } from './PlanningDashboardPage.js';
import type { PlanningDashboard } from '@/lib/api';

describe('PlanningDashboardPage helpers', () => {
  it('maps dashboard KPIs to their operational drill-down pages', () => {
    const dashboard: PlanningDashboard = {
      skuActiveCount: 100,
      skuOperationalCount: 70,
      skuDormantCount: 30,
      skuPlanningEligibleCount: 80,
      skuGrayLifecycleCount: 20,
      skuForecastCoveredCount: 60,
      skuForecastGapCount: 20,
      forecastCoverageRate: 0.75,
      healthRedCount: 24,
      healthYellowCount: 16,
      healthRedSkuCount: 8,
      healthYellowSkuCount: 12,
      belowRopCount: 15,
      pendingSuggestions: 6,
      delayedShipments: 3,
      delayedDraftsEtaAvailable: 4,
      stockoutRateApprox: 0.1,
      stockoutHorizon7: 5,
      stockoutHorizon15: 10,
      stockoutHorizon30: 20,
      overstockCount: 7,
      uncoverableByNewPoCount: 4,
      pendingShipOut: 0,
      pendingTransfer: 0,
      calculatedAt: '2026-07-29T12:00:00.000Z',
    };

    const cards = buildPlanningDashboardCards(dashboard);
    const byLabel = Object.fromEntries(cards.map((c) => [c.label, c]));

    assert.equal(byLabel['可规划 SKU']?.value, '80');
    assert.equal(byLabel['疑似停售']?.value, '20');
    assert.equal(byLabel['预测已覆盖']?.value, '60');
    assert.equal(byLabel['预测缺口']?.value, '20');
    assert.equal(byLabel['预测覆盖率']?.value, '75.0%');
    assert.equal(byLabel['新计划已来不及']?.value, '4');
    assert.equal(byLabel['新计划已来不及']?.href, '/inventory/alerts');
    assert.equal(byLabel['7天缺货（确定线）']?.value, '5');
    assert.equal(byLabel['7天缺货（确定线）']?.href, '/inventory/alerts');
    assert.equal(byLabel['15天缺货（确定线）']?.value, '10');
    assert.equal(byLabel['30天缺货（确定线）']?.value, '20');
    assert.equal(byLabel['库存积压']?.value, '7');
    assert.equal(byLabel['红灯 SKU']?.value, '8');
    assert.equal(byLabel['黄灯 SKU']?.value, '12');
    assert.equal(byLabel['待处理补货建议']?.href, '/pmc/suggestions');
    assert.equal(byLabel['数据问题']?.href, '/inventory/data-issues');
    assert.equal(byLabel['数据问题']?.value, '0');
    assert.equal(byLabel['未定仓供应']?.href, '/inventory/unallocated');
    assert.equal(byLabel['未定仓供应']?.value, '0');
    assert.equal(byLabel['断货风险率（近似）']?.value, '10.0%');
  });
});
