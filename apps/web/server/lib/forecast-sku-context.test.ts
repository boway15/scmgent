import { describe, expect, it } from 'vitest';
import { formatBaselineWeightsLabel } from './forecast-sku-context.js';

describe('formatBaselineWeightsLabel', () => {
  it('formats lifecycle weights as percentages', () => {
    expect(
      formatBaselineWeightsLabel({ w90: 0.5, w30: 0.3, wLy: 0.2, wCat: 0 }),
    ).toBe('50% / 30% / 20% / 0%');
  });

  it('formats new product weights', () => {
    expect(
      formatBaselineWeightsLabel({ w90: 0, w30: 0.7, wLy: 0, wCat: 0.3 }),
    ).toBe('0% / 70% / 0% / 30%');
  });
});
