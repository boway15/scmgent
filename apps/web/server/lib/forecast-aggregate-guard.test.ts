import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AGGREGATE_GUARD_CODE,
  applyAggregateGuardOverride,
  buildAggregateGuardIssues,
  classifyAggregateGuardRatio,
} from './forecast-aggregate-guard.js';

describe('forecast-aggregate-guard', () => {
  it('classifies the publish bands', () => {
    assert.equal(classifyAggregateGuardRatio(1), 'ok');
    assert.equal(classifyAggregateGuardRatio(0.8), 'ok');
    assert.equal(classifyAggregateGuardRatio(1.25), 'ok');
    assert.equal(classifyAggregateGuardRatio(0.7), 'warning');
    assert.equal(classifyAggregateGuardRatio(1.4), 'warning');
    assert.equal(classifyAggregateGuardRatio(0.5), 'error');
    assert.equal(classifyAggregateGuardRatio(1.8), 'error');
  });

  it('keeps small groups as info', () => {
    const issues = buildAggregateGuardIssues([
      {
        projectGroup: '小组',
        station: 'US',
        forecastYear: 2026,
        month: 11,
        forecastQty: 100,
        baselineQty: 40,
      },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.level, 'info');
  });

  it('downgrades only aggregate guard errors when a reason is given', () => {
    const issues = buildAggregateGuardIssues([
      {
        projectGroup: '组A',
        station: 'US',
        forecastYear: 2026,
        month: 11,
        forecastQty: 1000,
        baselineQty: 3000,
      },
    ]);
    assert.equal(issues[0]?.level, 'error');
    assert.equal(issues[0]?.code, AGGREGATE_GUARD_CODE);
    const waived = applyAggregateGuardOverride(issues, 'Q4 仍按运营校准下单');
    assert.equal(waived[0]?.level, 'warning');
    assert.match(waived[0]?.message ?? '', /人工放行/);
    const other = applyAggregateGuardOverride(
      [{ level: 'error', code: 'forecast_empty', message: '空' }],
      '原因',
    );
    assert.equal(other[0]?.level, 'error');
  });
});
