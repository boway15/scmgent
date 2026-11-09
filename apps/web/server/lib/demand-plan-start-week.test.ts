import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDemandPlanStartWeekOptions,
  buildDemandPlanWeekHorizon,
  isDemandPlanStartWeekBacktest,
  parseAndValidateDemandPlanStartWeek,
  planningTrainingWindowEndBeforeWeek,
  resolveDemandPlanSkuDetailActualDisplayWindow,
  resolveDemandPlanSkuDetailSalesWindow,
} from './demand-plan-start-week.js';
import { formatIsoWeekMondayMd } from './planning-calendar.js';

describe('demand-plan-start-week', () => {
  it('builds horizon from explicit start week', () => {
    const weeks = buildDemandPlanWeekHorizon('2026-W39', 3);
    assert.deepEqual(weeks, ['2026-W39', '2026-W40', '2026-W41']);
  });

  it('training window ends on Sunday before start week Monday', () => {
    const end = planningTrainingWindowEndBeforeWeek('2026-W39');
    assert.equal(end.toISOString().slice(0, 10), '2026-09-20');
    assert.equal(formatIsoWeekMondayMd('2026-W39'), '09-21');
  });

  it('detects backtest when start week is before current week', () => {
    assert.equal(
      isDemandPlanStartWeekBacktest('2026-W01', new Date('2026-09-25T00:00:00.000Z')),
      true,
    );
  });

  it('caps backtest window with max sale date', () => {
    const { windowEnd } = resolveDemandPlanSkuDetailSalesWindow({
      startWeek: '2026-W39',
      now: new Date('2026-09-25T00:00:00.000Z'),
      maxSaleDate: '2026-09-15',
    });
    assert.equal(windowEnd.toISOString().slice(0, 10), '2026-09-15');
  });

  it('actual display window ignores backtest training cutoff', () => {
    const end = resolveDemandPlanSkuDetailActualDisplayWindow({
      now: new Date('2026-11-06T00:00:00.000Z'),
      maxSaleDate: '2026-11-04',
    });
    assert.equal(end.toISOString().slice(0, 10), '2026-11-04');
  });

  it('parse validates lookback range', () => {
    const now = new Date('2026-09-25T00:00:00.000Z');
    const parsed = parseAndValidateDemandPlanStartWeek(undefined, now);
    assert.equal(parsed.isBacktest, false);
    assert.ok(buildDemandPlanStartWeekOptions(now).includes(parsed.startWeek));
  });
});
