import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPLENISHMENT_DEFAULTS } from './params.js';
import {
  DEFAULT_OVERSTOCK_THRESHOLD_DAYS,
  DEFAULT_SAFETY_STOCK_DAYS,
} from '../../lib/replenishment-coverage.js';
import { SINGLE_REPLENISHMENT_COVER_DAYS } from '../../lib/inventory-timeline.js';
import { SLOW_MOVING_MAX_DAILY, SLOW_MOVING_MIN_COVERAGE_DAYS } from '../../lib/inventory-light.js';
import { DEFAULT_PLANNING_SAFETY_STOCK_DAYS } from '../../lib/safety-stock-z.js';

describe('replenishment defaults match legacy constants', () => {
  it('all equal', () => {
    assert.equal(REPLENISHMENT_DEFAULTS.singleCoverDays, 30);
    assert.equal(SINGLE_REPLENISHMENT_COVER_DAYS, 30);
    assert.equal(DEFAULT_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_PLANNING_SAFETY_STOCK_DAYS, 14);
    assert.equal(DEFAULT_OVERSTOCK_THRESHOLD_DAYS, 180);
    assert.equal(SLOW_MOVING_MAX_DAILY, 0.1);
    assert.equal(SLOW_MOVING_MIN_COVERAGE_DAYS, 90);
    assert.equal(REPLENISHMENT_DEFAULTS.moqPriority, 'sku_then_spu');
    assert.equal(REPLENISHMENT_DEFAULTS.yellowLightLinkage, true);
    assert.equal(REPLENISHMENT_DEFAULTS.usNetworkDeferEnabled, true);
  });
});
