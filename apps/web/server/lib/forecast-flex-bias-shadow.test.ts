import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  applyFlexBiasShadowCorrection,
  FLEX_BIAS_CORRECTION_DISABLE_ENV,
  FLEX_BIAS_SHADOW_ENV,
  resolveFlexBiasCorrectionFactor,
  resolveFlexBiasShadowEnabled,
} from './forecast-flex-bias-shadow.js';
import { computeAllCatV41ForecastForMonth } from './forecast-allcat-v41.js';

describe('forecast-flex-bias-shadow', () => {
  const envSnapshot = process.env[FLEX_BIAS_SHADOW_ENV];
  const disableSnapshot = process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV];

  afterEach(() => {
    if (envSnapshot == null) delete process.env[FLEX_BIAS_SHADOW_ENV];
    else process.env[FLEX_BIAS_SHADOW_ENV] = envSnapshot;
    if (disableSnapshot == null) delete process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV];
    else process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV] = disableSnapshot;
  });

  beforeEach(() => {
    delete process.env[FLEX_BIAS_SHADOW_ENV];
    delete process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV];
  });

  it('enabled from calibration by default', () => {
    assert.equal(resolveFlexBiasShadowEnabled(), true);
  });

  it('disables via emergency env flag', () => {
    process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV] = '0';
    assert.equal(resolveFlexBiasShadowEnabled(), false);
  });

  it('explicit override wins over disable env', () => {
    process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV] = '0';
    assert.equal(resolveFlexBiasShadowEnabled(true), true);
  });

  it('does not correct near horizon or core tiers', () => {
    assert.equal(resolveFlexBiasCorrectionFactor({ tier: 'T1', horizonIndex: 4 }), null);
    assert.equal(resolveFlexBiasCorrectionFactor({ tier: 'T4A', horizonIndex: 2 }), null);
  });

  it('applies tier-specific factor in flex window', () => {
    const result = applyFlexBiasShadowCorrection({
      tier: 'T4A',
      horizonIndex: 4,
      forecastDaily: 10,
      flexBiasShadow: true,
    });
    assert.equal(result.applied, true);
    assert.equal(result.correctionFactor, 1.55);
    assert.equal(result.forecastDaily, 15.5);
    assert.equal(result.preFlexBiasDaily, 10);
  });

  it('computeAllCatV41ForecastForMonth writes shadow factors when enabled', () => {
    const monthlyRows = Array.from({ length: 12 }, (_, i) => ({
      saleYear: 2025 + (i >= 6 ? 1 : 0),
      month: ((i + 6) % 12) + 1,
      qtySold: 300 + i * 20,
    }));

    const baseline = computeAllCatV41ForecastForMonth({
      productCategory: 'C',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 5,
      horizonIndex: 4,
      monthlyRows,
      recent30DailyAvg: 12,
      recent90DailyAvg: 11,
      historyCapEnd: new Date('2026-01-31T00:00:00Z'),
      flexBiasShadow: false,
    });

    const shadow = computeAllCatV41ForecastForMonth({
      productCategory: 'C',
      platform: 'AMAZON',
      forecastYear: 2026,
      forecastMonth: 5,
      horizonIndex: 4,
      monthlyRows,
      recent30DailyAvg: 12,
      recent90DailyAvg: 11,
      historyCapEnd: new Date('2026-01-31T00:00:00Z'),
      flexBiasShadow: true,
    });

    if (shadow.tier === 'T4A' || shadow.tier === 'T4B') {
      assert.ok(shadow.forecastDaily >= baseline.forecastDaily);
      assert.equal(shadow.horizonFactors.flexBiasCorrectionApplied, true);
      assert.ok(Number(shadow.horizonFactors.flexBiasCorrection) > 1);
    }
  });
});
