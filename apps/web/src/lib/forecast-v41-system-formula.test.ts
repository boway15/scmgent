import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildV41LevelCellTitle,
  buildV41SystemBreakdown,
  buildV41SystemCellTitle,
  v41SeasonBlendWeight,
} from './forecast-v41-system-formula.js';

describe('forecast-v41-system-formula', () => {
  it('buildV41SystemBreakdown ends with actual forecastDailyAvg and numbered steps', () => {
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
    assert.match(title, /【V4\.1 系统日均 · 逐步计算】/);
    assert.match(title, /① 混合水平/);
    assert.match(title, /⑤ 乘积/);
    assert.match(title, /→ 系统 57\.82/);
    assert.doesNotMatch(title, /→ 系统 5[89]\./);
  });

  it('buildV41SystemBreakdown applies peerPlatformFloor before final system line', () => {
    const title = buildV41SystemBreakdown({
      blendLevel: 1,
      trendRatio: 1,
      forecastMonth: 7,
      horizonIndex: 0,
      tier: 'T4B',
      d6: 1,
      d3: 1,
      actualForecastDailyAvg: 4,
      boundedSnapshot: {
        effectiveTrendDecay: 1,
        monthFactor: 1,
        conservativeFactor: 0.9,
        tierCeiling: 2,
        peerPlatformFloor: 4,
      },
    });
    assert.match(title, /⑧ 跨平台近端抬底/);
    assert.match(title, /动销抬底 → 4\.00/);
    assert.match(title, /→ 系统 4\.00/);
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
    assert.ok(title?.includes('AI 辅助'));
    assert.ok(title?.includes('12.34'));
    assert.ok(title?.includes('促销拉升'));
    assert.ok(!title?.includes('逐步计算'));
  });

  it('buildV41SystemCellTitle explains multi-platform aggregate with contributions', () => {
    const title = buildV41SystemCellTitle({
      cell: {
        forecastDailyAvg: 24.59,
        month: 7,
      },
      v41: {
        levelDaily: 21.92,
        seasonalDaily: 17.58,
        trendRatio: 1.1,
        d6: 20,
        d3: 22,
        aggregatedPlatformCount: 2,
        platformContributions: [
          {
            platform: 'AMAZON',
            forecastDailyAvg: 21,
            levelDaily: 21,
            seasonalDaily: 17,
            tier: 'T1',
          },
          {
            platform: 'SHOPIFY',
            forecastDailyAvg: 3.59,
            levelDaily: 0.92,
            seasonalDaily: 0.58,
            tier: 'T3',
          },
        ],
        effectiveTrendDecay: 1.06,
        monthFactor: 0.98,
        conservativeFactor: 0.84,
      },
      monthIndex: 0,
      tier: 'T1',
    });
    assert.ok(title?.includes('【全渠道合计 · 系统日均】'));
    assert.ok(title?.includes('参与渠道：2'));
    assert.ok(title?.includes('AMAZON'));
    assert.ok(title?.includes('SHOPIFY'));
    assert.ok(title?.includes('系统 21.00'));
    assert.ok(title?.includes('系统 3.59'));
    assert.ok(title?.includes('合计'));
    assert.ok(title?.includes('系统 24.59'));
    assert.ok(title?.includes('混合 21.92'));
    assert.ok(!title?.includes('① 混合水平'));
  });

  it('v41SeasonBlendWeight follows min(0.62, 0.28 + k×0.07)', () => {
    assert.equal(v41SeasonBlendWeight(0), 0.28);
    assert.ok(Math.abs(v41SeasonBlendWeight(1) - 0.35) < 1e-9);
    assert.equal(v41SeasonBlendWeight(5), 0.62);
    assert.equal(v41SeasonBlendWeight(10), 0.62);
  });

  it('buildV41LevelCellTitle explains blend from anchor and seasonal', () => {
    const title = buildV41LevelCellTitle({
      kind: 'blend',
      cell: { month: 7, baselineDailyAvg: 21 },
      v41: {
        levelDaily: 21,
        anchorDaily: 22.33,
        seasonalDaily: 17.58,
        formula: '0.15*d2+0.55*d6+0.30*d12',
        d6: 20,
        d3: 22,
      },
      monthIndex: 0,
      tier: 'T1',
    });
    assert.ok(title?.includes('【混合水平 · 逐步计算】'));
    assert.ok(title?.includes('锚定日均 = 22.33'));
    assert.ok(title?.includes('季节朴素日均 = 17.58'));
    assert.ok(title?.includes('w=0.28'));
    assert.ok(title?.includes('→ 混合水平 21.00'));
  });

  it('buildV41LevelCellTitle explains baseline as levelDaily', () => {
    const title = buildV41LevelCellTitle({
      kind: 'baseline',
      cell: { month: 7, baselineDailyAvg: 21 },
      v41: {
        levelDaily: 21,
        anchorDaily: 22.33,
        seasonalDaily: 17.58,
      },
      monthIndex: 0,
      tier: 'T1',
    });
    assert.ok(title?.includes('【基线日均 · 逐步计算】'));
    assert.ok(title?.includes('基线」= 混合水平'));
    assert.ok(title?.includes('→ 基线 21.00'));
  });

  it('buildV41LevelCellTitle explains seasonal naive algorithm', () => {
    const title = buildV41LevelCellTitle({
      kind: 'seasonal',
      cell: { month: 8 },
      v41: { seasonalDaily: 17.58 },
      monthIndex: 1,
    });
    assert.ok(title?.includes('【季节朴素日均 · 算法】'));
    assert.ok(title?.includes('k=1'));
    assert.ok(title?.includes('→ 季节朴素 17.58'));
  });
});
