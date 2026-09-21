import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertManualAdjust,
  nextDemandPlanVersionNo,
  shouldArchivePrevious,
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
