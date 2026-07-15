import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySalesTier,
  extractSalesHistoryFeatures,
  isT1Elite,
  isT1Decline,
  resolveSalesTierSegment,
  resolveT1SubSegment,
  salesTierSkipsForecast,
  shouldForecastSalesTier,
  salesTierToProfileClass,
} from './forecast-sales-tier.js';
import { isTrainEndFading } from './forecast-monthly-abcd.js';

describe('forecast-sales-tier', () => {
  it('classifies zero train as T6', () => {
    assert.equal(classifySalesTier(Array(24).fill(0)), 'T6_zero');
    assert.equal(salesTierSkipsForecast('T6_zero'), true);
  });

  it('classifies high continuous volume as T1', () => {
    const qty = [200, 210, 190, 205, 198, 220, 215, 208, 212, 199, 205, 210];
    assert.equal(classifySalesTier(qty), 'T1_anchor');
    const f = extractSalesHistoryFeatures(qty);
    assert.equal(isT1Elite(f), true);
  });

  it('classifies intermittent as T4', () => {
    const qty = [0, 0, 50, 0, 0, 80, 0, 0, 40, 0, 0, 60];
    assert.equal(classifySalesTier(qty), 'T4_intermittent');
    assert.equal(salesTierToProfileClass('T4_intermittent'), 'C');
  });

  it('classifies new burst with holdout as T5', () => {
    const qty = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    assert.equal(classifySalesTier(qty, { holdoutSum: 500 }), 'T5_new_or_dormant');
  });

  it('resolves T1 elite segment', () => {
    const qty = Array(20).fill(250).concat([240, 260, 255]);
    const r = resolveSalesTierSegment(qty);
    assert.equal(r.tier, 'T1_anchor');
    assert.equal(r.segment, 'T1:elite');
  });

  it('attack phase only forecasts T1', () => {
    assert.equal(shouldForecastSalesTier('T1_anchor', 'attack'), true);
    assert.equal(shouldForecastSalesTier('T2_stable', 'attack'), false);
    assert.equal(shouldForecastSalesTier('T4_intermittent', 'attack'), false);
    assert.equal(shouldForecastSalesTier('T6_zero', 'attack'), false);
  });

  it('resolves T1 sub-segments', () => {
    const stable = extractSalesHistoryFeatures(Array(20).fill(250).concat([240, 260, 255]));
    assert.equal(resolveT1SubSegment(stable), 'T1.1_elite_stable');
    const decline = { ...stable, q4Boost: 0.82, collapsed: false };
    assert.equal(resolveT1SubSegment(decline), 'T1.2_elite_decline');
    const severeDecline = { ...stable, q4Boost: 0.7, collapsed: false };
    assert.equal(resolveT1SubSegment(severeDecline), 'T1.5_train_collapse');
    const collapsed = { ...stable, collapsed: true };
    assert.equal(resolveT1SubSegment(collapsed), 'T1.5_train_collapse');
    assert.equal(isT1Decline({ ...stable, q4Boost: 0.8 }), true);
  });

  it('routes train-end fading tail to T1.5', () => {
    const ts = [...Array(21).fill(520), 700, 650, 300];
    assert.equal(isTrainEndFading(ts), true);
    const fading = extractSalesHistoryFeatures(ts);
    assert.equal(fading.collapsed, true);
    assert.equal(resolveT1SubSegment(fading), 'T1.5_train_collapse');
  });
});
