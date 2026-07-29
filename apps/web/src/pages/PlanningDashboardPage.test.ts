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
      calculatedAt: '2026-07-29T12:00:00.000Z',
    };

    const cards = buildPlanningDashboardCards(dashboard);

    assert.deepEqual(
      cards.map(({ label, value, href }) => ({ label, value, href })),
      [
        { label: '启用 SKU', value: '100', href: '/inventory/overview' },
        { label: '红灯风险', value: '8', href: '/inventory/overview' },
        { label: '黄灯预警', value: '12', href: '/inventory/overview' },
        { label: '低于补货点', value: '15', href: '/inventory/alerts' },
        { label: '待处理补货建议', value: '6', href: '/pmc/suggestions' },
        { label: '延期采购跟单', value: '4', href: '/pmc/tracking' },
        { label: '延期发运', value: '3', href: '/pmc/shipments' },
        { label: '断货风险率（近似）', value: '8.0%', href: '/inventory/overview' },
      ],
    );
  });
});
