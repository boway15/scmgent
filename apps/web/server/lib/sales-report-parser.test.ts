import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDailySalesDateColumns,
  estimateDailySalesExpansion,
  normalizeStationFromReport,
  parseDailySalesRows,
  parseMonthlySalesWorkbookRows,
  parseSkuMonthlyWideRows,
} from './sales-report-parser.js';

describe('sales-report-parser', () => {
  it('detects parenthesized daily date columns', () => {
    const cols = detectDailySalesDateColumns([
      'SKU',
      '站点',
      '平台',
      '(2026-06-26)',
      '(2026-06-25)',
      '总计',
    ]);

    assert.deepEqual(cols, [
      { key: '(2026-06-26)', saleDate: '2026-06-26' },
      { key: '(2026-06-25)', saleDate: '2026-06-25' },
    ]);
  });

  it('normalizes known station labels', () => {
    assert.equal(normalizeStationFromReport('Amazon美国'), 'US');
    assert.equal(normalizeStationFromReport('TEMU-US'), 'US');
    assert.equal(normalizeStationFromReport('Amazon德国'), 'DE');
    assert.equal(normalizeStationFromReport('wayfair'), 'US');
    assert.equal(normalizeStationFromReport(''), 'US');
  });

  it('estimates worst-case daily wide expansion from headers', () => {
    const estimate = estimateDailySalesExpansion([
      {
        SKU: 'A',
        '(2026-06-01)': '1',
        '(2026-06-02)': '2',
        '(2026-06-03)': '3',
      },
      { SKU: 'B', '(2026-06-01)': '4' },
    ]);
    assert.deepEqual(estimate, {
      skuRowCount: 2,
      dateColumnCount: 3,
      expandedRowEstimate: 6,
    });
  });

  it('expands daily wide rows into positive long rows and diagnostics', () => {
    const result = parseDailySalesRows([
      {
        SKU: 'DJ502952_1',
        SKU名称: 'Desk',
        站点: 'Amazon美国',
        平台: '亚马逊',
        首单时间: '2023-04-29 07:08:25',
        品类: '办公-桌子',
        '(2026-06-26)': '2',
        '(2026-06-25)': '0',
      },
      {
        SKU: '',
        站点: 'Amazon美国',
        平台: '亚马逊',
        '(2026-06-26)': '5',
      },
    ]);

    assert.deepEqual(result.rows, [
      {
        skuCode: 'DJ502952_1',
        skuName: 'Desk',
        station: 'US',
        platformRaw: '亚马逊',
        firstOrderAt: '2023-04-29 07:08:25',
        category: '办公-桌子',
        saleDate: '2026-06-26',
        qtySold: 2,
      },
    ]);
    assert.equal(result.diagnostics.rowCount, 2);
    assert.equal(result.diagnostics.expandedRowCount, 1);
    assert.equal(result.diagnostics.skuCount, 1);
    assert.equal(result.diagnostics.startDate, '2026-06-26');
    assert.equal(result.diagnostics.endDate, '2026-06-26');
    assert.deepEqual(result.diagnostics.stationCounts, { US: 1 });
    assert.deepEqual(result.diagnostics.platformCounts, { '亚马逊': 1 });
    assert.match(result.diagnostics.errors[0], /missing SKU/);
  });

  it('parses BOM-prefixed SKU and spaced SKU name headers', () => {
    const result = parseDailySalesRows([
      {
        '\uFEFFSKU': 'DJ502952_2',
        'SKU 名称': 'Desk Plus',
        站点: 'Amazon美国',
        平台: '亚马逊',
        '(2026-06-26)': '3',
      },
    ]);

    assert.deepEqual(result.rows, [
      {
        skuCode: 'DJ502952_2',
        skuName: 'Desk Plus',
        station: 'US',
        platformRaw: '亚马逊',
        firstOrderAt: '',
        category: '',
        saleDate: '2026-06-26',
        qtySold: 3,
      },
    ]);
    assert.deepEqual(result.diagnostics.errors, []);
  });

  it('parses monthly project and category workbook rows', () => {
    const result = parseMonthlySalesWorkbookRows({
      '销量26.5': [
        ['总销量', '', ''],
        ['项目组', '2026-05)', '2026-04)'],
        ['Amazon项目1组', 100, 80],
      ],
      '品类26.5': [
        ['总销量', '', ''],
        ['品类', '2026-05)', '2026-04)'],
        ['办公-桌子', 200, 160],
      ],
    });

    assert.deepEqual(result.rows, [
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2026-05', qtySold: 100 },
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2026-04', qtySold: 80 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-05', qtySold: 200 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-04', qtySold: 160 },
    ]);
  });

  it('parses one-digit and dotted monthly headers', () => {
    const result = parseMonthlySalesWorkbookRows({
      '销量26.5': [
        ['项目组', '2023-1)', '2026.5'],
        ['Amazon项目1组', 20, 50],
      ],
      '品类26.5': [
        ['品类', '2023.1)', '2026-5'],
        ['办公-桌子', 30, 60],
      ],
    });

    assert.deepEqual(result.rows, [
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2023-01', qtySold: 20 },
      { dimensionType: 'project_group', dimensionValue: 'Amazon项目1组', month: '2026-05', qtySold: 50 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2023-01', qtySold: 30 },
      { dimensionType: 'category', dimensionValue: '办公-桌子', month: '2026-05', qtySold: 60 },
    ]);
  });

  it('expands SKU monthly wide rows with parenthesized month headers', () => {
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
    assert.deepEqual(result.rows[0], {
      skuCode: 'DJ502530_2',
      skuName: '',
      station: 'US',
      platformRaw: '亚马逊',
      category: '',
      saleYear: 2025,
      month: 7,
      qtySold: 310,
    });
    assert.deepEqual(result.rows[1], {
      skuCode: 'DJ502530_2',
      skuName: '',
      station: 'US',
      platformRaw: '亚马逊',
      category: '',
      saleYear: 2026,
      month: 5,
      qtySold: 1943,
    });
    assert.equal(result.diagnostics.startMonth, '2025-07');
    assert.equal(result.diagnostics.endMonth, '2026-05');
  });
});
