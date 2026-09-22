import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIsoWeeks,
  buildIsoWeekHorizon,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  planningRecentWindowEnd,
} from './planning-calendar.js';
import { getForecastDailyForDate } from './forecast-demand.js';

describe('planning-calendar', () => {
  it('uses ISO week Monday and 26-week horizon containing asOf', () => {
    // 2026-01-15 Thursday → ISO 2026-W03 (Mon 2026-01-12)
    assert.equal(isoWeekKeyFromUtcDate(new Date('2026-01-15T00:00:00.000Z')), '2026-W03');
    const weeks = buildIsoWeekHorizon(new Date('2026-01-15T00:00:00.000Z'), 26);
    assert.equal(weeks.length, 26);
    assert.equal(weeks[0], '2026-W03');
    assert.equal(weeks[25], addIsoWeeks('2026-W03', 25));
  });

  it('planning window ends yesterday in Asia/Shanghai', () => {
    const end = planningRecentWindowEnd(new Date('2026-01-15T02:00:00.000Z'));
    assert.equal(end.toISOString().slice(0, 10), '2026-01-14');
  });

  it('resolves ISO week key to Monday UTC', () => {
    const monday = isoWeekMondayUtc('2026-W05');
    assert.equal(monday.toISOString().slice(0, 10), '2026-01-26');
  });
});

describe('getForecastDailyForDate week map', () => {
  it('reads ISO week keys without month seasonal fallback', () => {
    const map = new Map([['2026-W03', 8]]);
    assert.equal(getForecastDailyForDate(map, new Date('2026-01-15T00:00:00.000Z'), 1), 8);
    assert.equal(getForecastDailyForDate(map, new Date('2026-01-20T00:00:00.000Z'), 1), 1);
  });
});
