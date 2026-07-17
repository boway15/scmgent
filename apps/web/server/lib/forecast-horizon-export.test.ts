import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForecastHorizonDetailCsv,
  buildForecastHorizonWideCsv,
  usesV41DetailColumns,
} from './forecast-horizon-export.js';
import type { ForecastHorizonRow } from './forecast-horizon.js';
import { ALLCAT_V41_MODEL } from './forecast-allcat-v41.js';

function sampleRow(overrides: Partial<ForecastHorizonRow> = {}): ForecastHorizonRow {
  return {
    skuId: 'sku-1',
    skuCode: 'SKU-A',
    skuName: '商品A',
    category: '猫砂',
    station: 'GLOBAL',
    platform: 'ALL',
    lifecycle: 'mature',
    forecastProfileClass: null,
    profileSegment: 'T1',
    months: [
      {
        id: 'm1',
        forecastYear: 2026,
        month: 7,
        monthLabel: '2026-07',
        forecastDailyAvg: 10,
        manualDailyAvg: null,
        effectiveDailyAvg: 10,
        adjustReason: null,
        baselineDailyAvg: 9,
        lifecycle: 'mature',
        confidenceLevel: 'high',
        skuTrendFactor: null,
        seasonalityFactor: 1,
        trendFactor: 1,
        categoryCombinedFactor: 1,
        categoryTrendWasClipped: false,
        categoryTrendMatched: true,
        horizonFactors: null,
        allCatV41Factors: {
          tier: 'T1',
          d6: 12,
          d3: 11,
          trendRatio: 1.05,
          cv6: 0.4,
          seasonalDaily: 10.5,
          formula: 'test',
          algorithm: 'v41',
        },
        forecastModel: ALLCAT_V41_MODEL,
      },
    ],
    historyMonths: [
      {
        forecastYear: 2026,
        month: 6,
        monthLabel: '2026-06',
        qtySold: 300,
        actualDailyAvg: 10,
      },
    ],
    ...overrides,
  };
}

describe('forecast-horizon-export', () => {
  it('buildForecastHorizonWideCsv matches future matrix columns', () => {
    const { csv, rowCount } = buildForecastHorizonWideCsv({
      horizon: [{ monthLabel: '2026-07' }, { monthLabel: '2026-08' }],
      historyHorizon: [],
      items: [sampleRow()],
    });
    assert.equal(rowCount, 1);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(lines[0], 'SKU,SKU名称,渠道,生命周期,分层,2026-07,2026-08');
    assert.equal(lines[1], 'SKU-A,商品A,ALL,成熟,T1 主力稳定,10.00,');
  });

  it('buildForecastHorizonDetailCsv uses V41 factor columns when present', () => {
    const row = sampleRow();
    assert.equal(usesV41DetailColumns([row]), true);
    const { csv, rowCount } = buildForecastHorizonDetailCsv({
      horizon: [{ monthLabel: '2026-07' }],
      historyHorizon: [{ monthLabel: '2026-06' }],
      items: [row],
    });
    assert.equal(rowCount, 2);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    assert.match(lines[0]!, /时段,SKU,品类,渠道,绝对月,生命周期,置信度,基线日均,T层,d6,趋势比,季节朴素,生效日均,系统预测,校准值/);
    assert.match(lines[1]!, /^历史,SKU-A,猫砂,ALL,2026-06,成熟,/);
    assert.match(lines[1]!, /,10\.00,,$/);
    assert.match(lines[2]!, /^未来,SKU-A,猫砂,ALL,2026-07,成熟,高,9\.00,T1,12\.00,1\.05,10\.50,10\.00,10\.00,$/);
  });
});
