import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWalkForwardVersionName,
  buildWalkForwardMonthTierSummary,
  computeWalkForwardUnconstrainedWmape,
  formatWalkForwardMonthTierSummaryLines,
  parseWalkForwardAsOf,
  resolveWalkForwardSkuUnconstrainMeta,
  resolveWalkForwardVersionName,
} from './forecast-walkforward-backtest.js';
import { buildMonthlyForecastHorizon, daysInCalendarMonth } from './forecast-baseline.js';
import { formatForecastMonth } from './forecast-demand.js';
import { computeWalkForwardAsOf } from './sales-history-monthly.js';
import { unconstrainMonthQty } from './forecast-demand-unconstrain.js';

describe('forecast-walkforward-backtest', () => {
  it('parses asOf date as UTC midnight', () => {
    const asOf = parseWalkForwardAsOf('2025-12-31');
    assert.equal(asOf.toISOString(), '2025-12-31T00:00:00.000Z');
  });

  it('builds version name from asOf and month count', () => {
    const asOf = parseWalkForwardAsOf('2025-12-31');
    assert.equal(buildWalkForwardVersionName(asOf, 6), 'WF-2025-12-31-6M');
  });

  it('appends timestamp when not replacing version', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const name = resolveWalkForwardVersionName({ asOf, monthCount: 6, replaceVersion: false });
    assert.match(name, /^WF-2026-01-01-6M-\d+$/);
  });

  it('keeps stable name when replacing version', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const name = resolveWalkForwardVersionName({
      asOf,
      monthCount: 6,
      replaceVersion: true,
    });
    assert.equal(name, 'WF-2026-01-01-6M');
  });

  it('targets Jan-Jun 2026 when asOf is start of Jan 2026 (cutoff = end of Dec 2025)', () => {
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const months = buildMonthlyForecastHorizon(asOf, 6);
    assert.deepEqual(
      months.map((m) => formatForecastMonth(m.forecastYear, m.month)),
      ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
    );
  });

  it('computeWalkForwardAsOf aligns with first target month for 6 completed months', () => {
    const today = new Date(Date.UTC(2026, 6, 3));
    assert.equal(computeWalkForwardAsOf(6, today), '2026-01-01');
  });

  it('buildWalkForwardMonthTierSummary groups by month and tier with mape and wmape', () => {
    const stats = buildWalkForwardMonthTierSummary(
      [
        { forecastYear: 2026, month: 1, profileSegment: 'T1', forecastDaily: 12, actualDaily: 10 },
        { forecastYear: 2026, month: 1, profileSegment: 'T2', forecastDaily: 8, actualDaily: 10 },
        { forecastYear: 2026, month: 2, profileSegment: 'T1', forecastDaily: 5, actualDaily: 5 },
      ],
      [
        { forecastYear: 2026, month: 1, monthLabel: '2026-01' },
        { forecastYear: 2026, month: 2, monthLabel: '2026-02' },
      ],
    );
    assert.equal(stats.length, 3);
    const t1Jan = stats.find((row) => row.monthLabel === '2026-01' && row.profileSegment === 'T1');
    assert.ok(t1Jan);
    assert.equal(t1Jan.comparableRows, 1);
    assert.equal(t1Jan.mape, 0.2);
    assert.equal(t1Jan.wmape, 0.2);
    const lines = formatWalkForwardMonthTierSummaryLines(
      [
        { forecastYear: 2026, month: 1, profileSegment: 'T1', forecastDaily: 12, actualDaily: 10 },
      ],
      [{ forecastYear: 2026, month: 1, monthLabel: '2026-01' }],
    );
    assert.ok(lines.some((l) => l.includes('WMAPE')));
  });

  it('skips unconstrained WMAPE when daily history is missing', () => {
    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-1',
          forecastYear: 2026,
          month: 5,
          forecastDaily: 5,
          actualDaily: 3,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: null,
      skuMetaByKey: new Map(),
    });
    assert.equal(result.status, 'skipped_no_daily');
    assert.equal(result.unconstrainedWmape, null);
  });

  it('skips unconstrained WMAPE when daily map has no rows', () => {
    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-1',
          forecastYear: 2026,
          month: 5,
          forecastDaily: 5,
          actualDaily: 3,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: new Map([['SKU-1', []]]),
      skuMetaByKey: new Map([
        ['SKU-1', { calendar90AtAsOf: 4, lifecycle: 'mature', firstSaleDate: '2025-01-01' }],
      ]),
    });
    assert.equal(result.status, 'skipped_no_daily');
    assert.equal(result.unconstrainedWmape, null);
  });

  it('computes WMAPE against unconstrained month actual when daily history exists', () => {
    const rows: Array<{ saleDate: string; qtySold: number }> = [];
    for (let d = 1; d <= 31; d += 1) {
      rows.push({
        saleDate: `2026-05-${String(d).padStart(2, '0')}`,
        qtySold: d <= 10 ? 0 : 5,
      });
    }
    const days = daysInCalendarMonth(2026, 5);
    const actualDaily = (21 * 5) / days;
    const monthU = unconstrainMonthQty({
      year: 2026,
      month: 5,
      rawQty: actualDaily * days,
      dailySales: rows,
      skuMayUnconstrain: true,
      firstSaleDate: '2025-01-01',
    });
    const unconstrainedActualDaily = monthU.cleanedQty / days;
    const forecastDaily = 4;
    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-CORE',
          forecastYear: 2026,
          month: 5,
          forecastDaily,
          actualDaily,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: new Map([['SKU-CORE', rows]]),
      skuMetaByKey: new Map([
        ['SKU-CORE', { calendar90AtAsOf: 4, lifecycle: 'mature', firstSaleDate: '2025-01-01' }],
      ]),
    });
    assert.equal(result.status, 'computed');
    assert.ok(unconstrainedActualDaily > actualDaily);
    assert.equal(
      result.unconstrainedWmape,
      Math.abs(forecastDaily - unconstrainedActualDaily) / unconstrainedActualDaily,
    );
  });

  it('does not unconstrain when asOf lifecycle is new even if the target month has a zero run', () => {
    const rows: Array<{ saleDate: string; qtySold: number }> = [];
    for (let d = 1; d <= 31; d += 1) {
      rows.push({
        saleDate: `2026-05-${String(d).padStart(2, '0')}`,
        qtySold: d <= 10 ? 0 : 5,
      });
    }
    const days = daysInCalendarMonth(2026, 5);
    const actualDaily = (21 * 5) / days;
    const forecastDaily = 5;
    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-NEW',
          forecastYear: 2026,
          month: 5,
          forecastDaily,
          actualDaily,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: new Map([['SKU-NEW', rows]]),
      skuMetaByKey: new Map([
        ['SKU-NEW', { calendar90AtAsOf: 4, lifecycle: 'new', firstSaleDate: '2026-04-01' }],
      ]),
    });
    assert.equal(result.status, 'computed');
    assert.equal(result.unconstrainedWmape, null);
  });

  it('excludes non-reconstructed months from unconstrained WMAPE', () => {
    const mayRows: Array<{ saleDate: string; qtySold: number }> = [];
    for (let d = 1; d <= 31; d += 1) {
      mayRows.push({
        saleDate: `2026-05-${String(d).padStart(2, '0')}`,
        qtySold: d <= 10 ? 0 : 10,
      });
    }
    const juneRows = Array.from({ length: 30 }, (_, i) => ({
      saleDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
      qtySold: 10,
    }));
    const dailySales = [...mayRows, ...juneRows];
    const mayDays = daysInCalendarMonth(2026, 5);
    const juneDays = daysInCalendarMonth(2026, 6);
    const mayActualDaily = (21 * 10) / mayDays;
    const juneActualDaily = (30 * 10) / juneDays;
    const mayU = unconstrainMonthQty({
      year: 2026,
      month: 5,
      rawQty: mayActualDaily * mayDays,
      dailySales,
      skuMayUnconstrain: true,
      firstSaleDate: '2025-01-01',
    });
    const juneU = unconstrainMonthQty({
      year: 2026,
      month: 6,
      rawQty: juneActualDaily * juneDays,
      dailySales,
      skuMayUnconstrain: true,
      firstSaleDate: '2025-01-01',
    });
    assert.equal(mayU.reconstructed, true);
    assert.equal(juneU.reconstructed, false);

    const mayUnconstrainedDaily = mayU.cleanedQty / mayDays;
    const juneUnconstrainedDaily = juneU.cleanedQty / juneDays;
    const mayForecast = 5;
    const juneForecast = 20;
    const reconstructedOnlyWmape =
      Math.abs(mayForecast - mayUnconstrainedDaily) / mayUnconstrainedDaily;
    const combinedWmape =
      (Math.abs(mayForecast - mayUnconstrainedDaily) +
        Math.abs(juneForecast - juneUnconstrainedDaily)) /
      (mayUnconstrainedDaily + juneUnconstrainedDaily);

    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-CORE',
          forecastYear: 2026,
          month: 5,
          forecastDaily: mayForecast,
          actualDaily: mayActualDaily,
          profileSegment: 'T1',
        },
        {
          skuKey: 'SKU-CORE',
          forecastYear: 2026,
          month: 6,
          forecastDaily: juneForecast,
          actualDaily: juneActualDaily,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: new Map([['SKU-CORE', dailySales]]),
      skuMetaByKey: new Map([
        ['SKU-CORE', { calendar90AtAsOf: 4, lifecycle: 'mature', firstSaleDate: '2025-01-01' }],
      ]),
    });
    assert.equal(result.status, 'computed');
    assert.notEqual(combinedWmape, reconstructedOnlyWmape);
    assert.equal(result.unconstrainedWmape, reconstructedOnlyWmape);
  });

  it('keeps original actual when the target month is a full stockout', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      saleDate: `2026-04-${String(i + 1).padStart(2, '0')}`,
      qtySold: 0,
    }));
    const result = computeWalkForwardUnconstrainedWmape({
      rows: [
        {
          skuKey: 'SKU-OUT',
          forecastYear: 2026,
          month: 4,
          forecastDaily: 5,
          actualDaily: 0,
          profileSegment: 'T1',
        },
      ],
      dailyBySku: new Map([['SKU-OUT', rows]]),
      skuMetaByKey: new Map([
        ['SKU-OUT', { calendar90AtAsOf: 3, lifecycle: 'mature', firstSaleDate: '2025-01-01' }],
      ]),
    });
    assert.equal(result.status, 'computed');
    assert.equal(result.unconstrainedWmape, null);
  });

  it('computes asOf calendar90 and lifecycle without using future month sales', () => {
    const daily: Array<{ saleDate: string; qtySold: number }> = [];
    for (let d = 3; d <= 31; d += 1) {
      daily.push({ saleDate: `2025-10-${String(d).padStart(2, '0')}`, qtySold: 2 });
    }
    for (let d = 1; d <= 30; d += 1) {
      daily.push({ saleDate: `2025-11-${String(d).padStart(2, '0')}`, qtySold: 2 });
    }
    for (let d = 1; d <= 31; d += 1) {
      daily.push({ saleDate: `2025-12-${String(d).padStart(2, '0')}`, qtySold: 2 });
    }
    for (let d = 1; d <= 31; d += 1) {
      daily.push({ saleDate: `2026-05-${String(d).padStart(2, '0')}`, qtySold: 80 });
    }
    const asOf = parseWalkForwardAsOf('2026-01-01');
    const meta = resolveWalkForwardSkuUnconstrainMeta({
      dailySales: daily,
      asOf,
      firstSaleDate: '2024-01-01',
    });
    assert.ok(meta.calendar90AtAsOf >= 1);
    assert.ok(meta.calendar90AtAsOf < 10);
    assert.notEqual(meta.lifecycle, 'new');
    assert.notEqual(meta.lifecycle, 'intermittent');
    const newMeta = resolveWalkForwardSkuUnconstrainMeta({
      dailySales: daily,
      asOf,
      firstSaleDate: '2025-12-15',
    });
    assert.equal(newMeta.lifecycle, 'new');
  });
});
