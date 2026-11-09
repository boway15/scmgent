import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDemandPlanWeeklyAlgo } from './demand-plan-algo-mode.js';

describe('demand-plan-algo-mode', () => {
  it('defaults to v41_inline', () => {
    assert.equal(resolveDemandPlanWeeklyAlgo(undefined, {}), 'v41_inline');
  });

  it('accepts v41_w aliases', () => {
    assert.equal(resolveDemandPlanWeeklyAlgo('v41_w', {}), 'v41_w');
    assert.equal(resolveDemandPlanWeeklyAlgo('allcat_v41_w', {}), 'v41_w');
  });
});
