import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGenerateBody } from './demand-plans.js';

describe('parseGenerateBody', () => {
  it('returns 400 when projectGroup is missing', () => {
    assert.throws(
      () => parseGenerateBody({ warehouseCode: 'US-WEST' }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
  });
});
