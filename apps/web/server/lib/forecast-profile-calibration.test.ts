import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignSegment,
  expandProfileCalibrationGrid,
  meetsSegmentationConstraints,
  scoreSegmentation,
  type SkuFeatureSnapshot,
} from './forecast-profile-calibration.js';
import {
  DEFAULT_FORECAST_CALIBRATION_CONFIG,
  DEFAULT_FORECAST_PROFILE_CONFIG,
  parseForecastCalibrationConfig,
} from './forecast-profile-config.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('forecast-profile-calibration', () => {
  it('assignSegment demotes weak continuity from A:core to A:mid', () => {
    const monthlyQty = [...Array(10).fill(3000), 0, 0];
    const feature: SkuFeatureSnapshot = {
      skuCode: 'SKU1',
      skuId: 'id1',
      monthlyQty,
      recent30DailyAvg: 10,
      recent90DailyAvg: 10,
      continuity: 10 / 12,
      cv: 0.5,
      segment: 'A:core',
    };
    const strict = {
      ...DEFAULT_FORECAST_PROFILE_CONFIG,
      coreContinuityMin: 0.9,
      coreRecent90Min: 5,
    };
    assert.equal(assignSegment(feature, strict), 'A:mid');
  });

  it('scores lower WMAPE when micro-sales SKUs leave A:core', () => {
    const goodMonthly = Array(12).fill(3000);
    const badMonthly = [...Array(10).fill(3000), 0, 0];
    const features = new Map<string, SkuFeatureSnapshot>([
      [
        'GOOD',
        {
          skuCode: 'GOOD',
          skuId: '1',
          monthlyQty: goodMonthly,
          recent30DailyAvg: 10,
          recent90DailyAvg: 10,
          continuity: 1,
          cv: 0.5,
          segment: 'A:core',
        },
      ],
      [
        'BAD',
        {
          skuCode: 'BAD',
          skuId: '2',
          monthlyQty: badMonthly,
          recent30DailyAvg: 10,
          recent90DailyAvg: 10,
          continuity: 10 / 12,
          cv: 0.5,
          segment: 'A:core',
        },
      ],
    ]);

    const rows = [
      {
        skuCode: 'GOOD',
        actualDaily: 10,
        forecastDaily: 11,
        mape: null,
        biasRate: null,
        forecastYear: 2026,
        month: 1,
      },
      {
        skuCode: 'BAD',
        actualDaily: 0.2,
        forecastDaily: 12,
        mape: null,
        biasRate: null,
        forecastYear: 2026,
        month: 1,
      },
    ];
    const asOf = new Date('2026-01-01T00:00:00.000Z');

    const loose = scoreSegmentation({
      rows,
      featuresBySku: features,
      config: { ...DEFAULT_FORECAST_PROFILE_CONFIG, coreContinuityMin: 0.8 },
      asOf,
    });
    const strict = scoreSegmentation({
      rows,
      featuresBySku: features,
      config: { ...DEFAULT_FORECAST_PROFILE_CONFIG, coreContinuityMin: 0.9 },
      asOf,
    });

    assert.ok(
      (strict.aCorePrecisionWmape ?? 1) <= (loose.aCorePrecisionWmape ?? 1),
    );
    assert.ok(strict.misclassifiedMicroShare < loose.misclassifiedMicroShare);
  });

  it('profile grid expands to expected combination count', () => {
    const grid = expandProfileCalibrationGrid();
    assert.equal(grid.length, 3 * 3 * 3 * 3);
  });

  it('meetsSegmentationConstraints enforces sku count and micro share', () => {
    const ok = meetsSegmentationConstraints(
      {
        config: DEFAULT_FORECAST_PROFILE_CONFIG,
        aCoreSkuCount: 60,
        aCorePrecisionWmape: 0.4,
        aCoreFlexWmape: 0.2,
        misclassifiedMicroShare: 0.03,
        matrixSummary: { cells: [], bySegment: [], byBand: [] },
      },
      { minACoreSkus: 50, maxMicroShare: 0.05 },
    );
    assert.equal(ok, true);
  });
});

describe('forecast-profile-config', () => {
  it('default JSON matches DEFAULT_FORECAST_CALIBRATION_CONFIG', () => {
    const path = resolve(here, '../config/forecast-calibration.json');
    const parsed = parseForecastCalibrationConfig(JSON.parse(readFileSync(path, 'utf8')));
    assert.deepEqual(parsed.profile, DEFAULT_FORECAST_CALIBRATION_CONFIG.profile);
    assert.deepEqual(parsed.aCore, DEFAULT_FORECAST_CALIBRATION_CONFIG.aCore);
  });
});
