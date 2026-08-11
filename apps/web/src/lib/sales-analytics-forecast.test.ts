import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_NAME,
  chooseModel,
  fitConfidenceFromR2,
  modelForecast,
  nextPeriodLabel,
  trendSeasonalForecast,
  trendSeasonalModelLabel,
} from './sales-analytics-forecast.js';

describe('sales-analytics-forecast', () => {
  it('picks naive for flat noisy short series', () => {
    const v = [10, 10, 10];
    const m = chooseModel(v, false);
    assert.ok(['naive', 'avg', 'trend'].includes(m.type));
    const fc = modelForecast(m, v.length, 3, '2026-07', false);
    assert.equal(fc.length, 3);
  });

  it('panel trend×seasonal yields varying months even when chooseModel would be naive', () => {
    // Mild trend + strong Dec peak; overall R² may stay low for auto-select.
    const periods = [
      '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
      '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    ];
    const series = periods.map((p, i) => {
      const mm = +p.split('-')[1]!;
      const season = mm === 12 ? 1.4 : mm === 8 ? 0.85 : 1;
      return Math.round((100 + i * 3) * season);
    });
    const auto = chooseModel(series, false, periods);
    // Panel path must still vary by month via seasonal factors.
    const panel = trendSeasonalForecast(series, periods, 5, false);
    assert.equal(panel.fc.length, 5);
    const vals = new Set(panel.fc.map((x) => x.val));
    assert.ok(vals.size > 1, `expected varying forecast months, got ${[...vals]} (auto=${auto.type})`);
    assert.ok(panel.fc.some((x) => x.val !== panel.last));
  });

  it('uses month thresholds and labels next periods', () => {
    // Strong linear growth → trend (r2 high, trendRel > 0.02)
    const rising = [10, 20, 30, 40, 50, 60, 70, 80];
    const m = chooseModel(rising, false);
    assert.equal(m.type, 'trend');
    assert.equal(MODEL_NAME.trend, '线性趋势');

    assert.equal(nextPeriodLabel('2026-07', 1, false), '2026-08');
    assert.equal(nextPeriodLabel('2026-12', 2, false), '2027-02');
    assert.equal(nextPeriodLabel('2026-W50', 3, true), '2027-W01');

    const fc = modelForecast(m, rising.length, 2, '2026-07', false);
    assert.equal(fc[0]!.ym, '2026-08');
    assert.ok(fc[0]!.val > rising[rising.length - 1]!);
  });

  it('does not pick seasonal for week series', () => {
    const rising = [10, 20, 30, 40, 50, 60, 70, 80];
    const m = chooseModel(rising, true);
    assert.ok(m.type === 'trend' || m.type === 'avg' || m.type === 'naive');
    assert.notEqual(m.type, 'seasonal');
  });

  it('labels unified matrix model with confidence bands', () => {
    assert.equal(fitConfidenceFromR2(0.7), '较高');
    assert.equal(fitConfidenceFromR2(0.4), '中等');
    assert.equal(fitConfidenceFromR2(0.1), '偏低');
    assert.equal(trendSeasonalModelLabel(false, 0.7), '趋势+季节');
    assert.match(trendSeasonalModelLabel(false, 0.2), /可信度偏低/);
    assert.match(trendSeasonalModelLabel(true, 0.4), /线性趋势.*可信度中等/);
  });
});
