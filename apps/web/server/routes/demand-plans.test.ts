import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAdoptForecastBody,
  parseDemandPlanView,
  parseGenerateBody,
  parsePublishBody,
} from './demand-plans.js';

describe('parseGenerateBody', () => {
  it('defaults to full scope when projectGroup is omitted', () => {
    assert.deepEqual(parseGenerateBody({ warehouseCode: 'US-WEST' }), {
      projectGroup: undefined,
      versionName: undefined,
    });
  });

  it('accepts optional versionName and trims projectGroup', () => {
    assert.deepEqual(parseGenerateBody({ projectGroup: ' 项目6组 ', versionName: ' 周计划 ' }), {
      projectGroup: '项目6组',
      versionName: '周计划',
    });
  });
});

describe('parseDemandPlanView', () => {
  it('defaults to wide and only accepts long explicitly', () => {
    assert.equal(parseDemandPlanView(undefined), 'wide');
    assert.equal(parseDemandPlanView('wide'), 'wide');
    assert.equal(parseDemandPlanView('long'), 'long');
    assert.equal(parseDemandPlanView('detail'), 'wide');
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
  it('requires projectGroup and defaults warehouse to ALL', () => {
    assert.throws(
      () => parseAdoptForecastBody({ warehouseCode: 'US-WEST' }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
    assert.deepEqual(parseAdoptForecastBody({ projectGroup: 'G1' }), {
      projectGroup: 'G1',
      warehouseCode: 'ALL',
    });
    assert.deepEqual(parseAdoptForecastBody({ projectGroup: ' G1 ', warehouseCode: ' US-WEST ' }), {
      projectGroup: 'G1',
      warehouseCode: 'US-WEST',
    });
  });
});
