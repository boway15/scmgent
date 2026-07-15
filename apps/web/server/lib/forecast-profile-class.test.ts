import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyForecastProfile,
  computeContinuity,
  computeCv,
  resolveProfileSegment,
  resolveSkuProfileSegment,
  segmentLabel,
} from './forecast-profile-class.js';

describe('forecast-profile-class', () => {
  it('classifies evergreen A', () => {
    const qty = [10, 12, 11, 10, 12, 11, 10, 12, 11, 10, 12, 11];
    assert.equal(classifyForecastProfile(qty), 'A');
    assert.equal(computeContinuity(qty), 1);
    assert.ok(computeCv(qty) < 1);
  });

  it('classifies volatile B', () => {
    const qty = [100, 100, 100, 100, 100, 800, 100, 100, 100, 100, 100, 800];
    assert.ok(computeCv(qty) >= 1);
    assert.equal(classifyForecastProfile(qty), 'B');
  });

  it('classifies long-tail C', () => {
    const qty = [0, 5, 0, 0, 4, 0, 0, 5, 0, 0, 4, 0];
    assert.equal(classifyForecastProfile(qty), 'C');
  });

  it('classifies problem D', () => {
    const qty = [0, 30, 0, 0, 0, 50, 0, 0, 0, 20, 0, 0];
    assert.equal(classifyForecastProfile(qty), 'D');
  });

  it('resolves A core segment', () => {
    const seg = resolveProfileSegment('A', { volumeTier: 'core' });
    assert.equal(seg, 'A:core');
    assert.equal(segmentLabel(seg), 'A·常青款·主力');
  });

  it('labels AllCategory V4.1 tier segments', () => {
    assert.equal(segmentLabel('T4B'), 'T4B 稳定保底');
    assert.equal(segmentLabel('T1'), 'T1 主力稳定');
  });

  it('resolves C pool segment', () => {
    assert.equal(resolveProfileSegment('C', { layer: 'pool' }), 'C:pool');
  });

  it('resolves D skipped segment', () => {
    assert.equal(resolveProfileSegment('D', { skipped: true }), 'D:skipped');
  });

  it('resolveSkuProfileSegment end-to-end', () => {
    const result = resolveSkuProfileSegment({
      monthlyQty: [10, 12, 11, 10, 12, 11],
    });
    assert.equal(result.profileClass, 'A');
    assert.equal(result.segment, 'A:core');
  });
});
