import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAYERED_UNGROUPED,
  LAYERED_UNCATEGORIZED,
  normalizeProjectGroup,
  categoryLeaf,
  addMonths,
  daysInMonth,
  buildHorizonPeriods,
} from './layered-forecast-dims.js';

describe('layered-forecast-dims', () => {
  it('normalizes project group', () => {
    assert.equal(normalizeProjectGroup(null), LAYERED_UNGROUPED);
    assert.equal(normalizeProjectGroup('  '), LAYERED_UNGROUPED);
    assert.equal(normalizeProjectGroup('项目1组'), '项目1组');
  });
  it('takes category leaf', () => {
    assert.equal(categoryLeaf('A/B/椅子'), '椅子');
    assert.equal(categoryLeaf(null), LAYERED_UNCATEGORIZED);
  });
  it('builds horizon and month helpers', () => {
    assert.equal(addMonths('2026-01', 1), '2026-02');
    assert.equal(daysInMonth('2026-02'), 28);
    assert.deepEqual(buildHorizonPeriods('2026-07', 3), ['2026-07', '2026-08', '2026-09']);
  });
});
