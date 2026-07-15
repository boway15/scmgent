import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastMap,
  aggregateForecastRows,
  calcCoverageDaysWithForecast,
  calcCoverageReplenishmentFromForecast,
  getForecastDailyForDate,
  normalizeSalesPlatform,
  parseMonthlyForecastFromRow,
  sumForecastDemand,
  resolveEffectiveForecastDailyAvg,
  mapForecastDailyFields,
  sumEffectiveForecastDailyAcrossPlatforms,
  resolveHorizonConsumptionDaily,
} from './forecast-demand.js';

describe('forecast-demand', () => {
  it('parses Chinese monthly forecast columns from wide row', () => {
    const months = parseMonthlyForecastFromRow({
      站点: 'US',
      SKU: 'DJ502952_1',
      '1月预测日均': '50',
      '2月预测日均': '50',
      '6月预测日均': '34',
      '10月预测日均': '20',
      '11月预测日均': '18',
      '12月预测日均': '15',
    });
    assert.deepEqual(
      months.map((m) => m.month),
      [1, 2, 6, 10, 11, 12],
    );
    assert.equal(months.find((m) => m.month === 6)?.daily, 34);
    assert.equal(months.find((m) => m.month === 12)?.daily, 15);
  });

  it('covers fewer days when forecast daily exceeds historical fallback', () => {
    const forecasts = buildForecastMap([
      { forecastYear: 2026, month: 6, forecastDailyAvg: 34 },
    ]);
    const start = new Date('2026-06-15T12:00:00');
    const withForecast = calcCoverageDaysWithForecast(200, forecasts, start, 2);
    const historicalOnly = 200 / 2;
    assert.ok(withForecast < historicalOnly);
  });

  it('uses forecast for suggested qty when in red zone', () => {
    const forecasts = buildForecastMap(
      Array.from({ length: 12 }, (_, i) => ({
        forecastYear: 2026,
        month: i + 1,
        forecastDailyAvg: 20,
      })),
    );
    const result = calcCoverageReplenishmentFromForecast({
      effectiveQty: 100,
      forecasts,
      historicalAvgDaily: 5,
      productionDays: 50,
      shippingDays: 45,
      inboundBufferDays: 7,
      safetyStockDays: 14,
      today: new Date('2026-06-01'),
    });
    assert.equal(result.demandSource, 'forecast');
    assert.ok(result.suggestedQty > 0);
    assert.equal(
      sumForecastDemand(forecasts, new Date('2026-06-01'), 30, 5),
      20 * 30,
    );
  });

  it('aggregates multi-platform forecast by calendar month', () => {
    const map = aggregateForecastRows([
      { forecastYear: 2026, month: 6, forecastDailyAvg: 20, platform: 'AMAZON' },
      { forecastYear: 2026, month: 6, forecastDailyAvg: 10, platform: 'WALMART' },
    ]);
    assert.equal(map.get('2026-06'), 30);
  });

  it('prefers platform-specific rows over ALL when both exist', () => {
    const map = aggregateForecastRows([
      { forecastYear: 2026, month: 3, forecastDailyAvg: 100, platform: 'ALL' },
      { forecastYear: 2026, month: 3, forecastDailyAvg: 20, platform: 'AMAZON' },
      { forecastYear: 2026, month: 3, forecastDailyAvg: 5, platform: 'WALMART' },
    ]);
    assert.equal(map.get('2026-03'), 25);
  });

  it('sums effective daily across platforms when some have manual calibration', () => {
    const total = sumEffectiveForecastDailyAcrossPlatforms([
      { forecastDailyAvg: 3.62, manualDailyAvg: null },
      { forecastDailyAvg: -3.77, manualDailyAvg: null },
    ]);
    assert.equal(total, -0.15);
    const mixed = sumEffectiveForecastDailyAcrossPlatforms([
      { forecastDailyAvg: 3.62, manualDailyAvg: 4.0 },
      { forecastDailyAvg: 1.0, manualDailyAvg: null },
    ]);
    assert.equal(mixed, 5);
  });

  it('falls back to same calendar month across years when next year missing', () => {
    const forecasts = buildForecastMap([{ forecastYear: 2026, month: 1, forecastDailyAvg: 40 }]);
    const jan2027 = new Date('2027-01-10');
    assert.equal(getForecastDailyForDate(forecasts, jan2027, 2), 40);
  });

  it('resolveEffectiveForecastDailyAvg prefers manual calibration when set', () => {
    assert.equal(resolveEffectiveForecastDailyAvg(5.5, 6.2), 6.2);
    assert.equal(resolveEffectiveForecastDailyAvg(5.5, null), 5.5);
    const mapped = mapForecastDailyFields({ forecastDailyAvg: '4.8', manualDailyAvg: '5.1' });
    assert.equal(mapped.forecastDailyAvg, 4.8);
    assert.equal(mapped.manualDailyAvg, 5.1);
    assert.equal(mapped.effectiveDailyAvg, 5.1);
  });

  it('normalizes platform aliases', () => {
    assert.equal(normalizeSalesPlatform('亚马逊'), 'AMAZON');
    assert.equal(normalizeSalesPlatform(''), 'ALL');
  });

  it('B class near month uses P90 for horizon consumption', () => {
    const daily = resolveHorizonConsumptionDaily({
      forecastDailyAvg: 10,
      forecastDailyP90: 14,
      horizonMonthIndex: 1,
      profileClass: 'B',
    });
    assert.equal(daily, 14);
  });
});
