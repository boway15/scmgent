import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateForecastRows,
  hasBlockingForecastIssues,
} from './forecast-validation.js';
import { formatForecastMonth, parseForecastMonth } from './forecast-demand.js';
import { buildForecastReviewSummary } from './forecast-agent.js';

describe('forecast-validation', () => {
  it('blocks publishing an empty forecast version', () => {
    const issues = validateForecastRows([]);

    assert.deepEqual(issues, [
      {
        level: 'error',
        code: 'forecast_empty',
        message: '预测版本没有明细，不能发布',
      },
    ]);
    assert.equal(hasBlockingForecastIssues(issues), true);
  });

  it('warns when ALL and specific platforms coexist', () => {
    const issues = validateForecastRows([
      {
        skuId: 's1',
        skuCode: 'SKU1',
        station: 'US',
        platform: 'ALL',
        forecastYear: 2026,
        month: 6,
        forecastDailyAvg: 100,
      },
      {
        skuId: 's1',
        skuCode: 'SKU1',
        station: 'US',
        platform: 'AMAZON',
        forecastYear: 2026,
        month: 6,
        forecastDailyAvg: 20,
      },
    ]);
    assert.ok(issues.some((i) => i.code === 'platform_mix_all_and_specific'));
    assert.equal(hasBlockingForecastIssues(issues), false);
  });

  it('warns on large month-over-month spike', () => {
    const issues = validateForecastRows([
      {
        skuId: 's1',
        skuCode: 'SKU1',
        station: 'US',
        platform: 'AMAZON',
        forecastYear: 2026,
        month: 5,
        forecastDailyAvg: 10,
      },
      {
        skuId: 's1',
        skuCode: 'SKU1',
        station: 'US',
        platform: 'AMAZON',
        forecastYear: 2026,
        month: 6,
        forecastDailyAvg: 20,
      },
    ]);
    assert.ok(issues.some((i) => i.code === 'monthly_spike'));
  });

  it('blocks negative and non-finite forecast daily averages but allows zero', () => {
    const issues = validateForecastRows([
      {
        skuId: 's1',
        skuCode: 'SKU1',
        station: 'US',
        platform: 'AMAZON',
        forecastYear: 2026,
        month: 5,
        forecastDailyAvg: 0,
      },
      {
        skuId: 's2',
        skuCode: 'SKU2',
        station: 'US',
        platform: 'WALMART',
        forecastYear: 2026,
        month: 5,
        forecastDailyAvg: Number.NaN,
      },
      {
        skuId: 's3',
        skuCode: 'SKU3',
        station: 'US',
        platform: 'WALMART',
        forecastYear: 2026,
        month: 5,
        forecastDailyAvg: -1,
      },
    ]);

    const invalidIssues = issues.filter((i) => i.code === 'invalid_forecast_daily_avg');
    assert.equal(invalidIssues.length, 2);
    assert.ok(invalidIssues.every((i) => i.level === 'error'));
    assert.ok(invalidIssues.some((i) => i.skuCode === 'SKU2'));
    assert.ok(invalidIssues.some((i) => i.skuCode === 'SKU3'));
    assert.equal(hasBlockingForecastIssues(issues), true);
  });
});

describe('forecast-month', () => {
  it('formats and parses YYYY-MM', () => {
    assert.equal(formatForecastMonth(2026, 3), '2026-03');
    assert.deepEqual(parseForecastMonth('2026-03'), { year: 2026, month: 3 });
    assert.equal(parseForecastMonth('bad'), null);
  });
});

describe('forecast-agent', () => {
  it('builds review summary without mutating values', () => {
    const summary = buildForecastReviewSummary({
      versionName: 'Q2 Draft',
      versionStatus: 'draft',
      rowCount: 10,
      issues: [
        {
          level: 'warning',
          code: 'coverage_gap',
          message: '缺少预测',
          skuCode: 'A',
          forecastMonth: '2026-12',
        },
      ],
    });
    assert.match(summary, /Q2 Draft/);
    assert.match(summary, /coverage_gap/);
  });
});
