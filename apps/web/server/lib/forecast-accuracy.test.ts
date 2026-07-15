import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewItemIdentity, buildReviewItemKey } from './forecast-collaboration.js';
import {
  buildLowAccuracyReviewItem,
  shouldCreateLowAccuracyReviewItem,
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
});
