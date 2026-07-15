import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeT1NearAnchorDaily, forecastT1AnchorDaily, applyT1EliteUpperBiasCap } from './forecast-t1-anchor.js';

describe('forecast-t1-anchor', () => {
  it('uses recent90 when train month collapsed', () => {
    const series = [190, 93, 128, 190, 93, 7];
    const anchor = computeT1NearAnchorDaily({
      recent30DailyAvg: 7 / 31,
      recent90DailyAvg: (190 + 93 + 7) / 3 / 30,
      riskSeries: series,
      forecastYear: 2026,
      forecastMonth: 1,
    });
    assert.ok(anchor > 7 / 31);
  });

  it('zeros when train ends with discontinuation', () => {
    const qty = [200, 210, 190, 205, 198, 220, 215, 208, 212, 199, 205, 0];
    const r = forecastT1AnchorDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
    });
    assert.equal(r.model, 'a_risk_zero');
    assert.equal(r.forecastDailyAvg, 0);
  });

  it('returns t1_anchor model for stable series', () => {
    const qty = [200, 210, 190, 205, 198, 220, 215, 208, 212, 199, 205, 210];
    const r = forecastT1AnchorDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      t1SubSegment: 'T1.1_elite_stable',
    });
    assert.equal(r.model, 't1_anchor');
    assert.ok(r.forecastDailyAvg > 0);
  });

  it('zeros T1.5 train collapse sub-segment', () => {
    const qty = [200, 210, 190, 205, 198, 220, 215, 208, 212, 199, 205, 7];
    const r = forecastT1AnchorDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 0,
      forecastYear: 2026,
      forecastMonth: 1,
      t1SubSegment: 'T1.5_train_collapse',
    });
    assert.equal(r.model, 'a_risk_zero');
  });

  it('applies dedicated decline path for T1.2', () => {
    const qty = [...Array(21).fill(280), 260, 240, 200];
    const stable = forecastT1AnchorDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 1,
      forecastYear: 2026,
      forecastMonth: 2,
      t1SubSegment: 'T1.1_elite_stable',
    });
    const decline = forecastT1AnchorDaily({
      monthlyQty: qty,
      rawMonthlyQty: qty,
      horizonIndex: 1,
      forecastYear: 2026,
      forecastMonth: 2,
      t1SubSegment: 'T1.2_elite_decline',
    });
    assert.ok(decline.forecastDailyAvg > 0);
    assert.equal(decline.model, 't1_anchor');
  });

  it('upper cap clamps elite over-forecast', () => {
    const capped = applyT1EliteUpperBiasCap({
      forecastDailyAvg: 10,
      anchorDaily: 5,
      horizonMonthIndex: 0,
    });
    assert.ok(capped <= 5 * 1.12 + 0.01);
    const low = applyT1EliteUpperBiasCap({
      forecastDailyAvg: 3,
      anchorDaily: 5,
      horizonMonthIndex: 0,
    });
    assert.equal(low, 3);
  });
});
