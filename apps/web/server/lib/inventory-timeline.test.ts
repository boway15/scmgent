import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calcProjectedBalance,
  calcSuggestedQtyFromTimeline,
  classifySupplyLot,
  DEFAULT_TIMELINE_HORIZONS,
  findStockoutDate,
  projectInventoryTimeline,
  type TimelineLot,
} from './inventory-timeline.js';

describe('inventory-timeline', () => {
  const today = '2026-09-17';

  /** 附件 §9/§10 样例：今日海外 1000，7 天在途 +500，15 天本地 +300，累计需求至 45 天 2600 → 缺口 -300 */
  const sampleLots: TimelineLot[] = [
    { pool: 'overseas', qty: 1000, availableAt: today },
    { pool: 'in_transit', qty: 500, availableAt: '2026-09-24' },
    { pool: 'local', qty: 300, availableAt: '2026-10-02' },
    { pool: 'local', qty: 500, availableAt: '2026-10-12' },
  ];

  // 累计需求：7→400, 15→900, 30→1800, 45→2600 → 日均分段用阶跃表模拟
  function demandAtHorizon(horizonDays: number): number {
    const table: Record<number, number> = {
      0: 0,
      7: 400,
      15: 900,
      30: 1800,
      45: 2600,
    };
    return table[horizonDays] ?? Math.round((2600 / 45) * horizonDays);
  }

  it('projects overseas supply at horizons (attachment §9)', () => {
    assert.equal(calcProjectedBalance({ lots: sampleLots, today, horizonDays: 0, reservedQty: 0, cumulativeDemand: 0 }).projectedOverseas, 1000);
    assert.equal(calcProjectedBalance({ lots: sampleLots, today, horizonDays: 7, reservedQty: 0, cumulativeDemand: 0 }).projectedOverseas, 1500);
    assert.equal(calcProjectedBalance({ lots: sampleLots, today, horizonDays: 15, reservedQty: 0, cumulativeDemand: 0 }).projectedOverseas, 1800);
    assert.equal(calcProjectedBalance({ lots: sampleLots, today, horizonDays: 30, reservedQty: 0, cumulativeDemand: 0 }).projectedOverseas, 2300);
    assert.equal(calcProjectedBalance({ lots: sampleLots, today, horizonDays: 45, reservedQty: 0, cumulativeDemand: 0 }).projectedOverseas, 2300);
  });

  it('computes balance and 45-day stockout of -300 (attachment §10)', () => {
    const at45 = calcProjectedBalance({
      lots: sampleLots,
      today,
      horizonDays: 45,
      reservedQty: 0,
      cumulativeDemand: demandAtHorizon(45),
    });
    assert.equal(at45.projectedBalance, -300);
    assert.equal(at45.cumulativeDemand, 2600);
  });

  it('builds full timeline with default horizons', () => {
    const timeline = projectInventoryTimeline({
      lots: sampleLots,
      today,
      reservedQty: 0,
      horizons: DEFAULT_TIMELINE_HORIZONS,
      cumulativeDemandFn: demandAtHorizon,
    });
    assert.equal(timeline.points.length, 5);
    assert.equal(timeline.points.find((p) => p.horizonDays === 45)?.projectedBalance, -300);
    assert.equal(timeline.points.find((p) => p.horizonDays === 0)?.projectedBalance, 1000);
  });

  it('finds first stockout date by scanning daily when avgDaily provided', () => {
    const stockout = findStockoutDate({
      lots: sampleLots,
      today,
      reservedQty: 0,
      avgDaily: 2600 / 45,
      maxDays: 60,
    });
    assert.ok(stockout);
    // 余额首次 <=0 应接近 45 天附近
    const day = Math.round(
      (new Date(`${stockout}T00:00:00Z`).getTime() -
        new Date(`${today}T00:00:00Z`).getTime()) /
        86400000,
    );
    assert.ok(day >= 40 && day <= 50, `stockout day=${day}`);
  });

  it('suggests replenishment qty from target horizon gap + safety + MOQ', () => {
    const qty = calcSuggestedQtyFromTimeline({
      projectedOverseasAtTarget: 2300,
      cumulativeDemandAtTarget: 2600,
      safetyStockQty: 200,
      moq: 100,
    });
    // max(0, ceil(2600+200-2300)) = 500
    assert.equal(qty, 500);
  });

  it('excludes local lots that are not yet ship-ready (caller filters eligible)', () => {
    const withoutLocal = sampleLots.filter((l) => l.pool !== 'local');
    const at30 = calcProjectedBalance({
      lots: withoutLocal,
      today,
      horizonDays: 30,
      reservedQty: 0,
      cumulativeDemand: 0,
    });
    assert.equal(at30.projectedOverseas, 1500);
  });
});

describe('classifySupplyLot', () => {
  const today = '2026-09-17';

  it('classifies supply lots by pool, dates, and production status', () => {
    assert.equal(
      classifySupplyLot({ pool: 'overseas', availableAt: '2026-09-17', today: '2026-09-17' }),
      'confirmed',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'in_transit',
        availableAt: '2026-09-24',
        etaEstimated: false,
        dateUnknown: false,
        today: '2026-09-17',
      }),
      'confirmed',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'in_transit',
        availableAt: '2026-11-16',
        etaEstimated: true,
        dateUnknown: true,
        today: '2026-09-17',
      }),
      'planned',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'local',
        availableAt: '2026-11-08',
        productionStatus: 'completed',
        shipReadyAt: '2026-09-17',
        today: '2026-09-17',
      }),
      'expected',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'local',
        availableAt: '2026-12-28',
        productionStatus: 'in_production',
        shipReadyAt: '2026-10-20',
        today: '2026-09-17',
      }),
      'planned',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'local',
        availableAt: '2026-11-20',
        productionStatus: 'completed',
        shipReadyAt: '2026-10-01',
        today: '2026-09-17',
      }),
      'planned',
    );
    assert.equal(
      classifySupplyLot({
        pool: 'local',
        availableAt: null,
        productionStatus: 'completed',
        today: '2026-09-17',
      }),
      'excluded',
    );
  });
});
