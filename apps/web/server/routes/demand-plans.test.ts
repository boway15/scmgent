import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAdoptForecastBody, parseGenerateBody, parsePublishBody } from './demand-plans.js';

describe('parseGenerateBody', () => {
  it('returns 400 when projectGroup is missing', () => {
    assert.throws(
      () => parseGenerateBody({ warehouseCode: 'US-WEST' }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
  });
});

describe('parsePublishBody', () => {
  it('defaults adopt to false and only accepts boolean true', () => {
    assert.deepEqual(parsePublishBody(undefined), { adopt: false });
    assert.deepEqual(parsePublishBody({}), { adopt: false });
    assert.deepEqual(parsePublishBody({ adopt: true }), { adopt: true });
    assert.deepEqual(parsePublishBody({ adopt: 'true' }), { adopt: false });
  });
});

describe('parseAdoptForecastBody', () => {
  it('requires projectGroup and warehouseCode', () => {
    assert.throws(
      () => parseAdoptForecastBody({ warehouseCode: 'US-WEST' }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
    assert.throws(
      () => parseAdoptForecastBody({ projectGroup: 'G1' }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
    assert.deepEqual(parseAdoptForecastBody({ projectGroup: ' G1 ', warehouseCode: ' US-WEST ' }), {
      projectGroup: 'G1',
      warehouseCode: 'US-WEST',
    });
  });
});
