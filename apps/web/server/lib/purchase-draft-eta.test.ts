import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEtaPatch } from './purchase-draft-eta.js';

describe('buildEtaPatch', () => {
  it('sets etaAvailable, confirmedDeliveryDate, and optional shipReadyAt', () => {
    assert.deepEqual(buildEtaPatch('2026-08-15'), {
      etaAvailable: '2026-08-15',
      confirmedDeliveryDate: '2026-08-15',
    });
    assert.deepEqual(buildEtaPatch('2026-08-15', { remainingLogisticsDays: 45 }), {
      etaAvailable: '2026-08-15',
      confirmedDeliveryDate: '2026-08-15',
      shipReadyAt: '2026-07-01',
    });
  });
});
