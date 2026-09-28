import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_NAME,
  chooseModel,
  clipDashboardSeasonality,
  fitConfidenceFromR2,
  maxForecastMomPct,
  modelForecast,
  nextPeriodLabel,
  preprocessForecastSeries,
  trendSeasonalForecast,
  trendSeasonalModelLabel,
} from './sales-analytics-forecast.js';

function months(fromY: number, fromM: number, n: number): string[] {
  const p: string[] = [];
  let y = fromY;
  let m = fromM;
  for (let i = 0; i < n; i++) {
    p.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return p;
}

describe('sales-analytics-forecast', () => {
  it('picks naive for flat noisy short series', () => {
    const v = [10, 10, 10];
    const m = chooseModel(v, false);
    assert.ok(['naive', 'avg', 'trend'].includes(m.type));
    const fc = modelForecast(m, v.length, 3, '2026-07', false);
    assert.equal(fc.length, 3);
  });

  it('panel trend×seasonal yields varying months with clipped factors', () => {
    const periods = months(2024, 1, 24);
    const series = periods.map((p, i) => {
      const mm = +p.split('-')[1]!;
      const season = mm === 12 ? 1.4 : mm === 8 ? 0.85 : 1;
      return Math.round((100 + i * 3) * season);
    });
    const panel = trendSeasonalForecast(series, periods, 5, false);
    assert.equal(panel.fc.length, 5);
    const vals = new Set(panel.fc.map((x) => x.val));
    assert.ok(vals.size > 1, `expected varying forecast months, got ${[...vals]}`);
    for (const m of Object.values(panel.sIdx)) {
      assert.ok(m >= 0.85 && m <= 1.15, `season factor ${m} out of clip range`);
    }
  });

  it('uses month thresholds and labels next periods', () => {
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
    assert.equal(trendSeasonalModelLabel(false, 0.7, 'seasonal'), '锚定+限幅季节');
    assert.match(trendSeasonalModelLabel(false, 0.2, 'seasonal'), /可信度偏低/);
    assert.match(trendSeasonalModelLabel(true, 0.4, 'trend'), /锚定\+衰减趋势.*可信度中等/);
    assert.equal(trendSeasonalModelLabel(false, 0.2, 'avg'), '移动平均（粗估）');
  });

  it('trims leading zeros so forecast does not start at zero', () => {
    const periods = months(2024, 9, 24);
    const series = periods.map((_, i) => (i < 16 ? 0 : Math.round(700 + (i - 16) * 60)));
    const panel = trendSeasonalForecast(series, periods, 6, false);
    assert.ok(panel.fc.every((x) => x.val > 0), `expected positive fc, got ${panel.fc.map((x) => x.val)}`);
    assert.ok(panel.anchor > 0);
  });

  it('falls back to moving average for noisy flat monthly series', () => {
    const periods = months(2024, 9, 24);
    const noise = [1.3, 0.6, 1.1, 0.75, 1.4, 0.9, 1.05, 0.8, 1.2, 0.7, 1.15, 0.85];
    const series = periods.map((_, i) => Math.round(1000 * noise[i % 12]!));
    const panel = trendSeasonalForecast(series, periods, 6, false);
    assert.equal(panel.path, 'avg');
    const uniq = new Set(panel.fc.map((x) => x.val));
    assert.equal(uniq.size, 1, 'avg path should produce flat forecast');
    for (let i = 1; i < panel.fc.length; i++) {
      assert.equal(panel.fc[i]!.val, panel.fc[0]!.val);
    }
  });

  it('prorates incomplete current month for fitting', () => {
    const periods = months(2024, 10, 24);
    const series = periods.map((p) => {
      const mm = +p.split('-')[1]!;
      const season = mm === 12 ? 1.4 : mm === 2 ? 0.7 : 1;
      return Math.round(1100 * season);
    });
    assert.equal(periods[periods.length - 1], '2026-09');
    series[series.length - 1] = Math.round(series[series.length - 1]! * 0.7);
    const now = new Date(2026, 8, 22); // 2026-09-22
    const pre = preprocessForecastSeries(series, periods, false, now);
    assert.ok(
      pre.series[pre.series.length - 1]! > series[series.length - 1]!,
      'incomplete month should be prorated upward for fit',
    );
    const panel = trendSeasonalForecast(series, periods, 3, false, now);
    const anchorGap =
      panel.anchor > 0
        ? Math.abs(panel.fc[0]!.val - panel.anchor) / panel.anchor
        : 0;
    assert.ok(
      anchorGap < 0.2,
      `first forecast should stay near prorated anchor, gap=${(anchorGap * 100).toFixed(1)}%`,
    );
  });

  it('clips dashboard seasonality to publish-aligned bounds', () => {
    assert.equal(clipDashboardSeasonality(1.64), 1.15);
    assert.equal(clipDashboardSeasonality(0.55), 0.85);
    assert.equal(clipDashboardSeasonality(1.05), 1.05);
  });

  it('reduces month-to-month swing versus unbounded seasonal extrapolation', () => {
    const periods = months(2024, 9, 24);
    const series = periods.map((p) => {
      const mm = +p.split('-')[1]!;
      const season = mm === 12 ? 1.8 : mm === 2 ? 0.55 : 1;
      return Math.round(980 * season);
    });
    const panel = trendSeasonalForecast(series, periods, 6, false);
    const mom = maxForecastMomPct(panel.fc, series[series.length - 1]!);
    assert.ok(mom != null && mom < 35, `expected swing under 35%, got ${mom}%`);
    const hi = Math.max(...panel.fc.map((x) => x.val));
    const lo = Math.min(...panel.fc.map((x) => x.val));
    assert.ok(hi / lo < 2.2, `expected hi/lo ratio < 2.2, got ${(hi / lo).toFixed(2)}`);
  });
});
