import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planExtractBatches } from './extract-runner.js';

describe('planExtractBatches', () => {
  it('defaults invalid batch sizes to one page per batch', () => {
    assert.deepEqual(planExtractBatches([1, 2, 3], 0), [[1], [2], [3]]);
    assert.deepEqual(planExtractBatches([1, 2], Number.NaN), [[1], [2]]);
  });

  it('keeps page order while grouping by batch size', () => {
    assert.deepEqual(planExtractBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
});
