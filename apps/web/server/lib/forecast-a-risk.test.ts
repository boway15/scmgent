import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAClassDemandRisk } from './forecast-a-risk.js';

describe('forecast-a-risk', () => {
  it('forces zero when last 2 train months are zero', () => {
    const r = evaluateAClassDemandRisk([10, 12, 8, 11, 0, 0]);
    assert.equal(r.forceZero, true);
    assert.equal(r.tier, 'stale');
  });

  it('forces zero when last 6 months mostly inactive', () => {
    const r = evaluateAClassDemandRisk([100, 0, 0, 0, 0, 5, 0, 0]);
    assert.equal(r.forceZero, true);
    assert.equal(r.tier, 'intermittent');
  });

  it('forces zero when only 2 of last 6 months active', () => {
    const r = evaluateAClassDemandRisk([100, 0, 0, 0, 12, 15, 0, 0]);
    assert.equal(r.forceZero, false);
    assert.equal(r.tier, 'intermittent');
    assert.ok(r.demandDiscount < 1);
  });

  it('does not force zero when last month is stockout but prior month sold', () => {
    const r = evaluateAClassDemandRisk([90, 92, 88, 91, 90, 89, 90, 91, 90, 0]);
    assert.equal(r.forceZero, false);
    assert.equal(r.tier, 'stale');
    assert.equal(r.demandDiscount, 1);
  });

  it('applies decline discount when last3 falls vs prior3', () => {
    const r = evaluateAClassDemandRisk([100, 100, 100, 100, 80, 70, 60, 50, 40, 30]);
    assert.equal(r.forceZero, false);
    assert.equal(r.tier, 'decline');
    assert.ok(r.demandDiscount < 1 && r.demandDiscount > 0);
  });

  it('marks stable for steady series', () => {
    const r = evaluateAClassDemandRisk([90, 92, 88, 91, 90, 89, 90, 91, 90, 92]);
    assert.equal(r.tier, 'stable');
    assert.equal(r.forceZero, false);
    assert.equal(r.demandDiscount, 1);
  });
});
