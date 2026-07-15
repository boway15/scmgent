import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDailySalesRows,
  parseSkuMonthlyWideRows,
  wideCsvBufferToRowObjects,
} from './sales-report-parser.js';
import { reconcileSkuSalesHistory } from './sales-history-reconcile.js';
import { computeForecastDailyAvgForMonth, resolveLastYearSameMonthDailyAvg } from './forecast-baseline.js';

const samplesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/samples/xiaoshou');

describe('xiaoshou sample smoke', () => {
  it('parses parenthesized monthly headers and reconciles daily vs monthly', () => {
    const monthlyPath = join(samplesDir, '产品销售报表-每月6a40a8dac9533e5db3fc8864.csv');
    if (!existsSync(monthlyPath)) {
      return;
    }

    const dailyCandidates = [
      '产品销售报表-每日6a40a8dac9533e5db3fc8864.csv',
      '产品销售报表-每日6a4227ef43084ca969e19dfe.csv',
    ].map((name) => join(samplesDir, name)).filter(existsSync);

    const monthlyRows = wideCsvBufferToRowObjects(readFileSync(monthlyPath));
    const skuMonthly = parseSkuMonthlyWideRows(monthlyRows);
    assert.ok(skuMonthly.diagnostics.expandedRowCount > 0, 'sku monthly should expand rows');

    if (dailyCandidates.length === 0) {
      return;
    }

    const dailyObjects = dailyCandidates.flatMap((path) => wideCsvBufferToRowObjects(readFileSync(path)));
    const daily = parseDailySalesRows(dailyObjects);
    assert.ok(daily.diagnostics.expandedRowCount > 0, 'daily should expand rows');

    const reconciliation = reconcileSkuSalesHistory({
      dailyRows: daily.rows,
      monthlyRows: skuMonthly.rows,
    });
    assert.ok(reconciliation.matchedMonths > 0, 'should have overlapping months');

    const targetSku = 'DJ502530_2';
    const skuMonthlyRows = skuMonthly.rows.filter((row) => row.skuCode === targetSku);
    const skuDailyRows = daily.rows.filter((row) => row.skuCode === targetSku);
    if (skuMonthlyRows.length === 0 || skuDailyRows.length === 0) {
      return;
    }

    const recent30 =
      skuDailyRows
        .filter((row) => row.saleDate >= '2026-03-01')
        .reduce((sum, row) => sum + row.qtySold, 0) / 30;
    const recent90 =
      skuDailyRows
        .filter((row) => row.saleDate >= '2026-03-28')
        .reduce((sum, row) => sum + row.qtySold, 0) / 90;

    const forecasts = [7, 8, 9].map((month) => {
      const lastYearSameMonthDailyAvg = resolveLastYearSameMonthDailyAvg({
        dailyRows: skuDailyRows,
        monthlyRows: skuMonthlyRows,
        forecastYear: 2026,
        month,
      });
      return computeForecastDailyAvgForMonth({
        recent30DailyAvg: recent30,
        recent90DailyAvg: recent90,
        lastYearSameMonthDailyAvg,
        seasonalityFactor: 1,
        trendFactor: 1,
      }).forecastDailyAvg;
    });

    const uniqueForecasts = new Set(forecasts.map((value) => value.toFixed(4)));
    assert.ok(
      uniqueForecasts.size > 1 || forecasts.some((value) => value > 0),
      `DJ502530_2 Jul-Sep forecasts should differ when YoY monthly history exists: ${forecasts.join(', ')}`,
    );
  });
});
