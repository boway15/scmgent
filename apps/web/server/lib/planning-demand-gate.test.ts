import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateDemandGate, isAutoAdoptableSuggestion } from './planning-demand-gate.js';

describe('planning-demand-gate', () => {
  it('flags reconstruct cap for manual confirm', () => {
    const result = evaluateDemandGate({
      reconstructCapHit: true,
      unconstrainedDaily: 2.5,
      stockoutDays: 20,
    });
    assert.equal(result.needsManualConfirm, true);
    assert.ok(result.flags.includes('reconstruct_capped'));
    assert.equal(result.demandCapped, true);
  });

  it('flags wmape fail for manual confirm', () => {
    const result = evaluateDemandGate({
      recentWmape: 0.5,
      segment: 'A:core',
      band: 'precision',
    });
    assert.equal(result.needsManualConfirm, true);
    assert.ok(result.flags.includes('wmape_fail'));
  });

  it('passes when accuracy is under target and not capped', () => {
    const result = evaluateDemandGate({
      recentWmape: 0.1,
      segment: 'A:core',
      band: 'precision',
      reconstructCapHit: false,
    });
    assert.equal(result.needsManualConfirm, false);
    assert.deepEqual(result.flags, []);
  });

  it('isAutoAdoptableSuggestion reads metrics flag', () => {
    assert.equal(isAutoAdoptableSuggestion({ needsManualConfirm: true }), false);
    assert.equal(isAutoAdoptableSuggestion({}), true);
  });
});
