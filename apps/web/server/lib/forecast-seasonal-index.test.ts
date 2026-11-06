import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSeasonalIndexSeries,
  computeLikeForLikeSeasonalIndex,
  createSeasonalIndexContext,
  resolveSkuSeasonStation,
  shrinkSeasonalIndex,
} from './forecast-seasonal-index.js';

function stableYear(skuId: string, year: number, qtyForMonth: (month: number) => number) {
  return Array.from({ length: 12 }, (_, index) => ({
    skuId,
    year,
    month: index + 1,
    qty: qtyForMonth(index + 1),
  }));
}

describe('forecast-seasonal-index', () => {
  it('lifts November and December above January for a stable cohort', () => {
    const points = ['s1', 's2', 's3', 's4'].flatMap((skuId) =>
      [2024, 2025].flatMap((year) =>
        stableYear(skuId, year, (month) => (month === 11 || month === 12 ? 200 : 100)),
      ),
    );
    const index = computeLikeForLikeSeasonalIndex(points, 2025, 12);
    assert.ok(index);
    assert.ok(index.byMonth[11]! > 1.3);
    assert.ok(index.byMonth[12]! > 1.3);
    assert.ok(index.byMonth[1]! < 1);
    const mean = Object.values(index.byMonth).reduce((sum, value) => sum + value, 0) / 12;
    assert.ok(Math.abs(mean - 1) < 0.02);
  });

  it('ignores a new SKU ramp that has not aged three months', () => {
    const stable = ['s1', 's2', 's3', 's4'].flatMap((skuId) =>
      [2024, 2025].flatMap((year) => stableYear(skuId, year, () => 100)),
    );
    const ramp = [
      { skuId: 'new', year: 2025, month: 10, qty: 5000 },
      { skuId: 'new', year: 2025, month: 11, qty: 8000 },
      { skuId: 'new', year: 2025, month: 12, qty: 9000 },
    ];
    const withRamp = computeLikeForLikeSeasonalIndex([...stable, ...ramp], 2025, 12);
    const without = computeLikeForLikeSeasonalIndex(stable, 2025, 12);
    assert.ok(withRamp && without);
    assert.ok(Math.abs(withRamp.byMonth[10]! - without.byMonth[10]!) < 0.05);
  });

  it('shrinks a thin category toward its parent and clips the result', () => {
    const parent = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1])) as Record<number, number>;
    const child = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 3])) as Record<number, number>;
    const thin = shrinkSeasonalIndex({
      child,
      childSampleQty: 0,
      parent,
      k: 100,
      clipMin: 0.6,
      clipMax: 1.8,
    });
    assert.equal(thin[6], 1);
    const strong = shrinkSeasonalIndex({
      child,
      childSampleQty: 1_000_000,
      parent,
      k: 100,
      clipMin: 0.6,
      clipMax: 1.8,
    });
    assert.equal(strong[6], 1.8);
  });

  it('resolves category, then project group, then station', () => {
    const flat = (monthValue: number) =>
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, monthValue])) as Record<number, number>;
    const context = createSeasonalIndexContext({
      historyCapEnd: new Date('2026-10-31T00:00:00.000Z'),
      config: { k: 1, clipMin: 0.6, clipMax: 1.8 },
      series: [
        {
          level: 'station',
          station: 'US',
          dimensionValue: 'US',
          sampleQty: 1000,
          byMonth: flat(1.1),
        },
        {
          level: 'project_group',
          station: 'US',
          dimensionValue: '组A',
          sampleQty: 1000,
          byMonth: flat(1.2),
        },
      ],
    });
    const categoryMiss = context.resolve({
      category: '椅',
      projectGroup: '组A',
      salesCountry: 'US',
    });
    assert.equal(categoryMiss.level, 'project_group');
    const unknown = context.resolve({ category: '椅', projectGroup: '没有', salesCountry: 'US' });
    assert.equal(unknown.level, 'station');
  });

  it('reads station from the project group suffix', () => {
    assert.equal(resolveSkuSeasonStation({ projectGroup: 'Amazon项目3组-第一曲线-EU' }), 'EU');
    assert.equal(resolveSkuSeasonStation({ salesCountry: 'us', projectGroup: 'x-EU' }), 'US');
  });

  it('builds one series per station, project group and category', () => {
    const points = ['a', 'b', 'c', 'd'].flatMap((skuId) =>
      [2024, 2025].flatMap((year) =>
        stableYear(skuId, year, (month) => (month === 11 ? 180 : 100)).map((point) => ({
          ...point,
          category: '椅',
          projectGroup: '组A',
          station: 'US',
        })),
      ),
    );
    const series = buildSeasonalIndexSeries({ points, capYear: 2025, capMonth: 12 });
    const levels = new Set(series.map((row) => row.level));
    assert.equal(levels.has('station'), true);
    assert.equal(levels.has('project_group'), true);
    assert.equal(levels.has('category'), true);
  });
});
