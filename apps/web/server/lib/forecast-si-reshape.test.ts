import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipSiReshapeScale, computeSiReshapeScales } from './forecast-si-reshape.js';

describe('forecast-si-reshape', () => {
  it('clips extreme scales', () => {
    assert.equal(clipSiReshapeScale(0.1), 0.72);
    assert.equal(clipSiReshapeScale(3), 1.45);
    assert.equal(clipSiReshapeScale(1.1), 1.1);
  });

  it('raises peak months and lowers trough while preserving mean level', () => {
    const plans = computeSiReshapeScales({
      months: [
        { key: 'g||2026-11', month: 11, sum: 1000 },
        { key: 'g||2026-12', month: 12, sum: 1000 },
        { key: 'g||2027-01', month: 1, sum: 1000 },
        { key: 'g||2027-02', month: 2, sum: 1000 },
        { key: 'g||2027-03', month: 3, sum: 1000 },
        { key: 'g||2027-04', month: 4, sum: 1000 },
      ],
      siByMonth: {
        11: 1.177,
        12: 1.335,
        1: 1.013,
        2: 1.08,
        3: 1.097,
        4: 0.868,
      },
    });
    const byMonth = new Map(plans.map((plan) => [plan.month, plan]));
    assert.ok((byMonth.get(12)?.scale ?? 0) > 1);
    assert.ok((byMonth.get(11)?.scale ?? 0) > 1);
    assert.ok((byMonth.get(4)?.scale ?? 1) < 1);
    assert.ok((byMonth.get(12)?.target ?? 0) > (byMonth.get(2)?.target ?? 0));
    const meanTarget =
      plans.reduce((sum, plan) => sum + plan.target, 0) / plans.length;
    assert.ok(Math.abs(meanTarget - 1000) < 1e-6);
  });
});
