import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcMilestoneDelayDays } from './shipment-delay.js';

const today = new Date('2026-07-29T12:00:00.000Z');

describe('calcMilestoneDelayDays', () => {
  it('returns null without a planned date', () => {
    assert.equal(calcMilestoneDelayDays(null, '2026-07-30', today), null);
  });

  it('returns zero when the milestone is on time', () => {
    assert.equal(calcMilestoneDelayDays('2026-07-29', null, today), 0);
    assert.equal(calcMilestoneDelayDays('2026-07-30', null, today), 0);
    assert.equal(calcMilestoneDelayDays('2026-07-29', '2026-07-28', today), 0);
  });

  it('calculates completed milestone delay in calendar days', () => {
    assert.equal(calcMilestoneDelayDays('2026-07-20', '2026-07-23', today), 3);
  });

  it('calculates overdue open milestone delay against today', () => {
    assert.equal(calcMilestoneDelayDays('2026-07-20', null, today), 9);
  });

  it('uses UTC calendar dates instead of partial elapsed days', () => {
    assert.equal(
      calcMilestoneDelayDays('2026-07-28T23:00:00-07:00', null, today),
      1,
    );
  });
});
