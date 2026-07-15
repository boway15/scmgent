import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildV41SystemBreakdown,
  buildV41SystemCellTitle,
} from './forecast-v41-system-formula.js';

describe('forecast-v41-system-formula', () => {
  it('buildV41SystemBreakdown ends with actual forecastDailyAvg', () => {
    const title = buildV41SystemBreakdown({
      blendLevel: 77.47,
      trendRatio: 0.8,
      forecastMonth: 7,
      horizonIndex: 0,
      tier: 'T1',
      d6: 66.21,
      d3: 68,
      productCategory: 'B',
      recent30DailyAvg: 80,
      recent90DailyAvg: 66,
      actualForecastDailyAvg: 57.8234,
      boundedSnapshot: {
        productCategory: 'B',
        effectiveTrendDecay: 0.85,
        monthFactor: 0.98,
        conservativeFactor: 0.86,
        tierCeiling: 69.52,
        growthSignal: false,
        rollingRatio: 1.21,
      },
    });
    assert.match(title, /→ 系统 57\.82/);
    assert.doesNotMatch(title, /→ 系统 5[89]\./);
  });

  it('buildV41SystemCellTitle prefers AI rationale over formula', () => {
    const title = buildV41SystemCellTitle({
      cell: {
        forecastDailyAvg: 12.34,
        month: 8,
        aiAssistRationale: '促销拉升，上调近端预测',
      },
      v41: {
        levelDaily: 10,
        trendRatio: 1,
        d6: 8,
        d3: 7,
      },
      monthIndex: 1,
      tier: 'T2',
    });
    assert.ok(title?.includes('AI 辅助预测'));
    assert.ok(title?.includes('12.34'));
    assert.ok(title?.includes('促销拉升'));
  });
});
