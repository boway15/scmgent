import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewItemIdentity, buildReviewItemKey } from './forecast-collaboration.js';
import {
  buildLowAccuracyReviewItem,
  computeAccuracyRowMetrics,
  FORECAST_ACCURACY_DETAIL_CSV_HEADERS,
  FORECAST_ACCURACY_MISS_DETAIL_CSV_HEADERS,
  formatAccuracyBiasVsActualDisplay,
  formatAccuracyDailyDisplay,
  shouldCreateLowAccuracyReviewItem,
  shouldPersistAccuracyRow,
  shouldRefreshLowAccuracyReviewItem,
} from './forecast-accuracy.js';

describe('forecast-accuracy', () => {
  it('builds low accuracy review item feedback from MAPE and actual daily average', () => {
    const item = buildLowAccuracyReviewItem({
      skuId: 'sku-1',
      skuCode: 'SKU-001',
      station: 'US',
      platform: 'AMAZON',
      targetYear: 2026,
      targetMonth: 7,
      mape: 0.314,
      actualDaily: 12.3456,
      forecastDaily: 8.5,
    });

    assert.deepEqual(item, {
      skuId: 'sku-1',
      station: 'US',
      platform: 'AMAZON',
      issueType: 'low_accuracy',
      severity: 'warning',
      message: 'SKU-001 2026-07 MAPE 31%，需复核下一轮预测',
      suggestedDailyAvg: 12.3456,
    });
  });

  it('preserves reviewed and ignored low accuracy review items', () => {
    assert.equal(shouldRefreshLowAccuracyReviewItem('reviewed'), false);
    assert.equal(shouldRefreshLowAccuracyReviewItem('ignored'), false);
  });

  it('refreshes pending low accuracy review items', () => {
    assert.equal(shouldRefreshLowAccuracyReviewItem('pending'), true);
  });

  it('creates low accuracy review item feedback when actual daily is zero with positive forecast', () => {
    assert.equal(
      shouldCreateLowAccuracyReviewItem({
        mape: null,
        actualDaily: 0,
        forecastDaily: 12.3456,
      }),
      true,
    );

    const item = buildLowAccuracyReviewItem({
      skuId: 'sku-1',
      skuCode: 'SKU-001',
      station: 'US',
      platform: 'AMAZON',
      targetYear: 2026,
      targetMonth: 7,
      mape: null,
      actualDaily: 0,
      forecastDaily: 12.3456,
    });

    assert.equal(
      item.message,
      'SKU-001 2026-07 实际日均为 0，预测日均 12.35，需复核下一轮预测',
    );
    assert.equal(item.suggestedDailyAvg, 0);
  });

  it('uses review item identity dimensions for low accuracy idempotency', () => {
    const item = buildLowAccuracyReviewItem({
      skuId: 'sku-1',
      skuCode: 'SKU-001',
      station: 'US',
      platform: 'AMAZON',
      targetYear: 2026,
      targetMonth: 7,
      mape: 0.31,
      actualDaily: 10,
      forecastDaily: 7,
    });
    const identity = buildReviewItemIdentity('version-1', item);

    assert.deepEqual(identity, {
      versionId: 'version-1',
      skuId: 'sku-1',
      station: 'US',
      platform: 'AMAZON',
      issueType: 'low_accuracy',
    });
    assert.equal(
      buildReviewItemKey(identity),
      'version-1::sku-1::US::AMAZON::low_accuracy',
    );
  });

  it('persists zero-forecast miss rows (forecast=0, actual>0) and skips zero-zero', () => {
    assert.equal(shouldPersistAccuracyRow({ forecastDaily: 1.2, actualDaily: 0 }), true);
    assert.equal(shouldPersistAccuracyRow({ forecastDaily: 1.2, actualDaily: 3 }), true);
    assert.equal(shouldPersistAccuracyRow({ forecastDaily: 0, actualDaily: 5 }), true);
    assert.equal(shouldPersistAccuracyRow({ forecastDaily: 0, actualDaily: 0 }), false);
  });

  it('computes miss-row metrics as MAPE 100% and biasVsActual -100%', () => {
    const miss = computeAccuracyRowMetrics({ forecastDaily: 0, actualDaily: 8 });
    assert.equal(miss.isZeroForecastMiss, true);
    assert.equal(miss.mape, 1);
    assert.equal(miss.biasRate, null);
    assert.equal(miss.biasVsActual, -1);

    const normal = computeAccuracyRowMetrics({ forecastDaily: 10, actualDaily: 8 });
    assert.equal(normal.isZeroForecastMiss, false);
    assert.equal(normal.mape, 0.25);
    assert.equal(normal.biasRate, (8 - 10) / 10);
    assert.equal(normal.biasVsActual, (10 - 8) / 8);
  });

  it('uses Chinese CSV headers aligned with accuracy list columns', () => {
    assert.deepEqual(FORECAST_ACCURACY_DETAIL_CSV_HEADERS, [
      '商品编码',
      '项目组',
      '商品分层',
      '渠道',
      '月份',
      '预测日均',
      '实际日均',
      '偏差',
    ]);
    assert.deepEqual(FORECAST_ACCURACY_MISS_DETAIL_CSV_HEADERS, [
      '商品编码',
      '项目组',
      '商品分层',
      '渠道',
      '月份',
      '预测日均',
      '实际日均',
    ]);
    assert.equal(formatAccuracyDailyDisplay(10.456), '10.46');
    assert.equal(formatAccuracyBiasVsActualDisplay(0.012), '+1.2%');
    assert.equal(formatAccuracyBiasVsActualDisplay(-0.301), '-30.1%');
    assert.equal(formatAccuracyBiasVsActualDisplay(null), '-');
  });
});
