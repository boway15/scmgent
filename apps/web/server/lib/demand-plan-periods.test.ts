import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDemandPlanPeriodColumns } from './demand-plan-periods.js';

describe('buildDemandPlanPeriodColumns', () => {
  it('builds ISO week columns from startWeek', () => {
    assert.deepEqual(
      buildDemandPlanPeriodColumns({
        startWeek: '2026-W39',
        horizonWeeks: 3,
        startMonth: '2026-09',
        horizonMonths: 6,
      }),
      ['2026-W39', '2026-W40', '2026-W41'],
    );
  });

  it('builds month columns when no startWeek', () => {
    assert.deepEqual(
      buildDemandPlanPeriodColumns({
        startWeek: null,
        horizonWeeks: null,
        startMonth: '2026-11',
        horizonMonths: 3,
      }),
      ['2026-11', '2026-12', '2027-01'],
    );
  });
});
