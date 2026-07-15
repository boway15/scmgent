import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiAssistHorizonFactors,
  normalizeForecastExogenousInput,
  serializeExogenousJson,
  validateExogenousAgainstHorizon,
  validateHumanAssistInput,
} from './forecast-exogenous-input.js';

describe('forecast-exogenous-input', () => {
  it('normalizes exogenous factors', () => {
    const result = normalizeForecastExogenousInput({
      factors: [
        { monthLabel: '2026-08', reason: 'price_change', intensity: -10, note: '降价' },
      ],
      operatorNote: 'Prime Day',
    });
    assert.equal(result?.factors.length, 1);
    assert.equal(result?.factors[0]?.reason, 'price_change');
    assert.equal(result?.operatorNote, 'Prime Day');
  });

  it('rejects invalid reason', () => {
    assert.throws(
      () =>
        normalizeForecastExogenousInput({
          factors: [{ monthLabel: '2026-08', reason: 'invalid' }],
        }),
      /Invalid exogenous reason/,
    );
  });

  it('requires human mode input', () => {
    assert.throws(
      () => validateHumanAssistInput({ assistMode: 'human' }),
      /至少填写一条外生因素/,
    );
  });

  it('allows human mode with operator note only', () => {
    const result = validateHumanAssistInput({
      assistMode: 'human',
      exogenousFactors: { factors: [], operatorNote: '下月大促' },
    });
    assert.equal(result?.operatorNote, '下月大促');
  });

  it('validates month labels against horizon', () => {
    assert.throws(
      () =>
        validateExogenousAgainstHorizon(
          { factors: [{ monthLabel: '2099-01', reason: 'ad' }] },
          new Set(['2026-07', '2026-08']),
        ),
      /不在预测周期内/,
    );
  });

  it('serializes empty exogenous json', () => {
    assert.equal(
      serializeExogenousJson(undefined),
      JSON.stringify({ factors: [], operatorNote: '' }),
    );
  });

  it('builds ai assist horizon factors with human mode', () => {
    const factors = buildAiAssistHorizonFactors({
      assistMode: 'human',
      exogenous: {
        factors: [{ monthLabel: '2026-08', reason: 'ad', intensity: 1.5 }],
      },
      tier: 'SKU',
      reviewTier: null,
      rationale: 'test',
      confidence: 'medium',
    });
    assert.equal(factors.assistMode, 'human');
    assert.equal(factors.source, 'ai_assist');
    assert.ok(Array.isArray((factors.exogenous as { factors: unknown[] }).factors));
  });
});
