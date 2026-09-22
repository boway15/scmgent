import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertAdoptWeeklyComplete,
  assertManualAdjust,
  canAdoptWeeklyCounts,
  championCoversHorizon,
  isAdoptWeeklyComplete,
  nextDemandPlanVersionNo,
  shouldArchivePrevious,
  shouldResetAdoptionOnArchive,
  shouldWriteAdoptionOnPublish,
} from './demand-plan-service.js';

describe('nextDemandPlanVersionNo', () => {
  it('pads sequence to two digits as DP-YYYYMMDD-NN', () => {
    assert.equal(nextDemandPlanVersionNo(new Date('2026-09-21T15:04:00.000Z'), 1), 'DP-20260921-01');
    assert.equal(nextDemandPlanVersionNo(new Date('2026-01-05T00:00:00.000Z'), 12), 'DP-20260105-12');
  });
});

describe('assertManualAdjust', () => {
  it('allows null manual without a reason', () => {
    assert.doesNotThrow(() => assertManualAdjust(null, null));
    assert.doesNotThrow(() => assertManualAdjust(null, ''));
  });

  it('allows manual when reason is non-empty after trim', () => {
    assert.doesNotThrow(() => assertManualAdjust(1.5, '  季节调整  '));
  });

  it('throws status 400 when manual is set without a trimmed reason', () => {
    const cases: Array<[number | null, string | null]> = [
      [2, null],
      [2, ''],
      [2, '   '],
      [0, null],
    ];
    for (const [manual, reason] of cases) {
      assert.throws(
        () => assertManualAdjust(manual, reason),
        (err: unknown) => (err as { status?: number }).status === 400,
      );
    }
  });
});

describe('shouldArchivePrevious', () => {
  it('is true only for pilot_published', () => {
    assert.equal(shouldArchivePrevious({ existingStatus: 'pilot_published' }), true);
    assert.equal(shouldArchivePrevious({ existingStatus: 'draft' }), false);
    assert.equal(shouldArchivePrevious({ existingStatus: 'archived' }), false);
  });
});

describe('canAdoptWeeklyCounts', () => {
  it('accepts complete 26-week SKUs and rejects partial or empty', () => {
    assert.equal(canAdoptWeeklyCounts([26, 26]), true);
    assert.equal(canAdoptWeeklyCounts([26, 13]), false);
    assert.equal(canAdoptWeeklyCounts([]), false);
    assert.equal(canAdoptWeeklyCounts([26]), true);
  });
});

describe('shouldWriteAdoptionOnPublish', () => {
  it('is false unless adopt is explicitly true', () => {
    assert.equal(shouldWriteAdoptionOnPublish(undefined), false);
    assert.equal(shouldWriteAdoptionOnPublish(false), false);
    assert.equal(shouldWriteAdoptionOnPublish(true), true);
  });
});

describe('shouldResetAdoptionOnArchive', () => {
  it('is true only when adoption points at the archived version', () => {
    assert.equal(
      shouldResetAdoptionOnArchive({ archivedVersionId: 'v1', adoptionVersionId: 'v1' }),
      true,
    );
    assert.equal(
      shouldResetAdoptionOnArchive({ archivedVersionId: 'v1', adoptionVersionId: 'v2' }),
      false,
    );
    assert.equal(
      shouldResetAdoptionOnArchive({ archivedVersionId: 'v1', adoptionVersionId: null }),
      false,
    );
  });
});

describe('isAdoptWeeklyComplete', () => {
  const complete = {
    horizonWeeks: 26 as const,
    startWeek: '2026-W03',
    skuWeekCounts: [26],
  };

  it('allows draft only when allowDraft is true (publish adopt precheck)', () => {
    assert.equal(
      isAdoptWeeklyComplete({ status: 'draft', ...complete, allowDraft: true }),
      true,
    );
    assert.equal(isAdoptWeeklyComplete({ status: 'draft', ...complete }), false);
    assert.equal(isAdoptWeeklyComplete({ status: 'pilot_published', ...complete }), true);
  });

  it('rejects incomplete weeks even for draft precheck', () => {
    assert.equal(
      isAdoptWeeklyComplete({
        status: 'draft',
        allowDraft: true,
        horizonWeeks: 26,
        startWeek: '2026-W03',
        skuWeekCounts: [26, 13],
      }),
      false,
    );
    assert.throws(
      () =>
        assertAdoptWeeklyComplete({
          status: 'draft',
          allowDraft: true,
          horizonWeeks: 26,
          startWeek: null,
          skuWeekCounts: [26],
        }),
      (err: unknown) =>
        (err as { status?: number; message?: string }).status === 400 &&
        (err as Error).message === '该版本周行不完整，不能采用',
    );
  });
});

describe('championCoversHorizon', () => {
  it('rejects a 3-month champion as insufficient for 6-month horizon', () => {
    const forecastMap = new Map<string, number>([
      ['2026-09', 1.2],
      ['2026-10', 1.1],
      ['2026-11', 1.0],
    ]);
    assert.equal(championCoversHorizon(forecastMap, '2026-09', 6), false);
  });

  it('accepts 6 consecutive positive months from startMonth', () => {
    const forecastMap = new Map<string, number>([
      ['2026-09', 1],
      ['2026-10', 1],
      ['2026-11', 1],
      ['2026-12', 1],
      ['2027-01', 1],
      ['2027-02', 1],
    ]);
    assert.equal(championCoversHorizon(forecastMap, '2026-09', 6), true);
  });

  it('accepts 12 months when the first 6 keys are present and positive', () => {
    const forecastMap = new Map<string, number>([
      ['2026-09', 1],
      ['2026-10', 1],
      ['2026-11', 1],
      ['2026-12', 1],
      ['2027-01', 1],
      ['2027-02', 1],
      ['2027-03', 1],
      ['2027-04', 1],
      ['2027-05', 1],
      ['2027-06', 1],
      ['2027-07', 1],
      ['2027-08', 1],
    ]);
    assert.equal(championCoversHorizon(forecastMap, '2026-09', 6), true);
  });
});
