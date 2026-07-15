import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompletedCalendarMonths,
  monthlyDailyAvgFromRows,
  monthlyQtyFromRows,
} from './sales-history-monthly.js';
import { resolveLastYearSameMonthDailyAvg } from './forecast-baseline.js';
import { buildForecastAccuracyBacktestSummary } from './forecast-accuracy.js';
import { parseSkuMonthlyWideRows } from './sales-report-parser.js';

describe('sales-history-monthly helpers', () => {
  it('builds completed calendar months from most recent backwards', () => {
    assert.deepEqual(buildCompletedCalendarMonths(2, new Date('2026-06-29T00:00:00.000Z')), [
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
    ]);
  });

  it('reads monthly qty and daily average from monthly rows', () => {
    const rows = [
      { saleYear: 2025, month: 7, qtySold: 310 },
      { saleYear: 2025, month: 8, qtySold: 620 },
    ];

    assert.equal(monthlyQtyFromRows(rows, 2025, 7), 310);
    assert.equal(monthlyDailyAvgFromRows(rows, 2025, 7), 10);
  });
});

describe('resolveLastYearSameMonthDailyAvg', () => {
  it('falls back to monthly rows when daily history is missing', () => {
    const dailyRows = [{ saleDate: '2026-06-01', qtySold: 5 }];
    const monthlyRows = [{ saleYear: 2025, month: 7, qtySold: 310 }];

    assert.equal(
      resolveLastYearSameMonthDailyAvg({
        dailyRows,
        monthlyRows,
        forecastYear: 2026,
        month: 7,
      }),
      10,
    );
  });
});

describe('forecast accuracy backtest summary', () => {
  it('summarizes month-by-month backtest stats', () => {
    const summary = buildForecastAccuracyBacktestSummary({
      monthResults: [
        { year: 2026, month: 4, upserted: 120, highMapeCount: 8 },
        { year: 2026, month: 5, upserted: 130, highMapeCount: 5 },
      ],
      totalUpserted: 250,
      totalHighMapeCount: 13,
    });

    assert.match(summary, /回测月份数：2/);
    assert.match(summary, /2026-04/);
    assert.match(summary, /高偏差 8 次/);
  });
});

describe('parseSkuMonthlyWideRows', () => {
  it('expands SKU monthly wide rows with month headers', () => {
    const result = parseSkuMonthlyWideRows([
      {
        SKU: 'DJ502952_1',
        站点: 'Amazon美国',
        平台: '亚马逊',
        '2025-07': '310',
        '2025-08': '620',
      },
    ]);

    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows[0], {
      skuCode: 'DJ502952_1',
      skuName: '',
      station: 'US',
      platformRaw: '亚马逊',
      category: '',
      saleYear: 2025,
      month: 7,
      qtySold: 310,
    });
    assert.equal(result.diagnostics.startMonth, '2025-07');
    assert.equal(result.diagnostics.endMonth, '2025-08');
  });

  it('expands xiaoshou-style parenthesized month columns', () => {
    const result = parseSkuMonthlyWideRows([
      {
        SKU: 'DJ502530_2',
        站点: 'Amazon美国',
        平台: '亚马逊',
        '(2025-07)': '310',
        '(2026-05)': '1943',
      },
    ]);

    assert.equal(result.rows.length, 2);
    assert.equal(result.diagnostics.expandedRowCount, 2);
    assert.equal(result.diagnostics.startMonth, '2025-07');
    assert.equal(result.diagnostics.endMonth, '2026-05');
  });
});
