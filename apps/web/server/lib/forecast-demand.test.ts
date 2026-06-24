import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastMap,
  calcCoverageDaysWithForecast,
  calcCoverageReplenishmentFromForecast,
  parseMonthlyForecastFromRow,
  sumForecastDemand,
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
    });
    assert.deepEqual(
      months.map((m) => m.month),
      [1, 2, 6, 10],
    );
    assert.equal(months.find((m) => m.month === 6)?.daily, 34);
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
});
