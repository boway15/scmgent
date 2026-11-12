import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateRegionInventoryByChannel,
  resolveChannelWeights,
} from './region-channel-inventory.js';

describe('region-channel-inventory', () => {
  it('prefers forecast weights', () => {
    const { source, weights } = resolveChannelWeights({
      forecastQtyByPlatform: { AMAZON: 80, WALMART: 20 },
      historyQtyByPlatform: { AMAZON: 1, WALMART: 99 },
    });
    assert.equal(source, 'forecast');
    assert.ok(Math.abs(weights.AMAZON! - 0.8) < 1e-9);
  });

  it('falls back to history when forecast empty', () => {
    const { source, weights } = resolveChannelWeights({
      forecastQtyByPlatform: { AMAZON: 0, WALMART: 0 },
      historyQtyByPlatform: { AMAZON: 30, WALMART: 70 },
    });
    assert.equal(source, 'history');
    assert.ok(Math.abs(weights.WALMART! - 0.7) < 1e-9);
  });

  it('returns empty when both sources are zero', () => {
    const { source, weights } = resolveChannelWeights({
      forecastQtyByPlatform: {},
      historyQtyByPlatform: { AMAZON: 0 },
    });
    assert.equal(source, 'empty');
    assert.deepEqual(weights, {});
  });

  it('allocates integers conserving sum', () => {
    const out = allocateRegionInventoryByChannel({
      regionQty: 10,
      channelWeights: { AMAZON: 0.5, WALMART: 0.5 },
    });
    assert.equal(out.AMAZON! + out.WALMART!, 10);
  });
});
