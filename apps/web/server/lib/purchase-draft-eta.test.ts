import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEtaPatch } from './purchase-draft-eta.js';

describe('buildEtaPatch', () => {
  it('sets both etaAvailable and confirmedDeliveryDate', () => {
    assert.deepEqual(buildEtaPatch('2026-08-15'), {
      etaAvailable: '2026-08-15',
      confirmedDeliveryDate: '2026-08-15',
    });
  });
});
