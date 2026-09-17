import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlanningDashboardCards } from './PlanningDashboardPage.js';
import type { PlanningDashboard } from '@/lib/api';

describe('PlanningDashboardPage helpers', () => {
  it('maps dashboard KPIs to their operational drill-down pages', () => {
    const dashboard: PlanningDashboard = {
      skuActiveCount: 100,
      healthRedCount: 8,
      healthYellowCount: 12,
      belowRopCount: 15,
      pendingSuggestions: 6,
      delayedShipments: 3,
      delayedDraftsEtaAvailable: 4,
      stockoutRateApprox: 0.08,
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

    assert.equal(byLabel['新计划已来不及']?.value, '4');
    assert.equal(byLabel['新计划已来不及']?.href, '/inventory/alerts');
    assert.equal(byLabel['7天缺货（确定线）']?.value, '5');
    assert.equal(byLabel['7天缺货（确定线）']?.href, '/inventory/alerts');
    assert.equal(byLabel['15天缺货（确定线）']?.value, '10');
    assert.equal(byLabel['30天缺货（确定线）']?.value, '20');
    assert.equal(byLabel['库存积压']?.value, '7');
    assert.equal(byLabel['红灯风险']?.value, '8');
    assert.equal(byLabel['待处理补货建议']?.href, '/pmc/suggestions');
  });
});
