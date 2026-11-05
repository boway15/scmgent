import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIsoWeeks,
  buildIsoWeekHorizon,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  maxSaleDateKey,
  planningAssumedSalesCutoff,
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

  it('assumed sales cutoff is business day minus lag (default 2)', () => {
    assert.equal(
      planningAssumedSalesCutoff(new Date('2026-01-15T02:00:00.000Z')).toISOString().slice(0, 10),
      '2026-01-13',
    );
    assert.equal(
      planningAssumedSalesCutoff(new Date('2026-01-15T02:00:00.000Z'), 1).toISOString().slice(0, 10),
      '2026-01-14',
    );
  });

  it('planning window ends at lag cutoff by default', () => {
    const end = planningRecentWindowEnd(new Date('2026-01-15T02:00:00.000Z'));
    assert.equal(end.toISOString().slice(0, 10), '2026-01-13');
  });

  it('caps window end at maxSaleDate when earlier than lag cutoff', () => {
    const end = planningRecentWindowEnd(new Date('2026-10-25T08:00:00.000Z'), {
      maxSaleDate: '2026-10-22',
    });
    assert.equal(end.toISOString().slice(0, 10), '2026-10-22');
  });

  it('keeps lag cutoff when maxSaleDate is on or after assumed end', () => {
    const end = planningRecentWindowEnd(new Date('2026-10-25T08:00:00.000Z'), {
      maxSaleDate: '2026-10-24',
    });
    assert.equal(end.toISOString().slice(0, 10), '2026-10-23');
  });

  it('maxSaleDateKey picks latest valid date', () => {
    assert.equal(
      maxSaleDateKey([
        { saleDate: '2026-10-20' },
        { saleDate: '2026-10-23T00:00:00.000Z' },
        { saleDate: 'bad' },
        { saleDate: '2026-10-21' },
      ]),
      '2026-10-23',
    );
    assert.equal(maxSaleDateKey([]), null);
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
