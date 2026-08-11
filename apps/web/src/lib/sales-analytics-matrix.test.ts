import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMatrixRows } from './sales-analytics-matrix.js';
import type { SalesAnalyticsEntity } from './sales-analytics-types.js';

function entity(partial: Partial<SalesAnalyticsEntity> & { v: number[] }): SalesAnalyticsEntity {
  const n = partial.v.length;
  return {
    s: 'US',
    b: '项目1组',
    c: '床',
    p: '亚马逊',
    vw: Array.from({ length: n }, () => 0),
    ...partial,
  };
}

describe('buildMatrixRows', () => {
  it('uses unified trend×seasonal forecasts (varying months, not flat avg/naive)', () => {
    const periods = [
      '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
      '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    ];
    const v = periods.map((p, i) => {
      const mm = +p.split('-')[1]!;
      const season = mm === 12 ? 1.4 : mm === 8 ? 0.85 : 1;
      return Math.round((100 + i * 3) * season);
    });
    const rows = buildMatrixRows({
      entities: [entity({ v })],
      mode: 's',
      periods,
      gran: 'month',
      rangeStart: 0,
      rangeEnd: periods.length - 1,
      horizon: 5,
    });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.match(row.modelLabel, /趋势\+季节/);
    assert.doesNotMatch(row.modelLabel, /移动平均|朴素法/);
    assert.equal(row.fc.length, 5);
    const uniq = new Set(row.fc.map((x) => x.val));
    assert.ok(uniq.size > 1, `expected varying fc months, got ${[...uniq]}`);
    assert.ok(row.reason.includes('与底部预估同口径'));
    assert.ok(row.r2 >= 0);
    assert.ok(['较高', '中等', '偏低'].includes(row.confidence));
  });

  it('labels week rows as linear trend without seasonal', () => {
    const periods = Array.from({ length: 20 }, (_, i) => {
      const w = i + 1;
      return `2025-W${String(w).padStart(2, '0')}`;
    });
    const v = periods.map((_, i) => 50 + i * 2);
    const rows = buildMatrixRows({
      entities: [entity({ v, vw: v })],
      mode: 'b',
      periods,
      gran: 'week',
      rangeStart: 0,
      rangeEnd: periods.length - 1,
      horizon: 4,
    });
    assert.equal(rows[0]!.modelLabel.includes('线性趋势'), true);
    assert.doesNotMatch(rows[0]!.modelLabel, /季节/);
  });
});
