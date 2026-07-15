import { describe, expect, it } from 'vitest';
import {
  assertPurchaseDraftTransition,
  deriveReceiptStatus,
  normalizePurchaseDraftStatus,
} from './purchase-draft-lifecycle.js';

describe('purchase-draft-lifecycle', () => {
  it('migrates legacy submitted to confirmed', () => {
    expect(normalizePurchaseDraftStatus('submitted')).toBe('confirmed');
  });

  it('allows draft to confirmed', () => {
    expect(() => assertPurchaseDraftTransition('draft', 'confirmed')).not.toThrow();
  });

  it('blocks received to draft', () => {
    expect(() => assertPurchaseDraftTransition('received', 'draft')).toThrow();
  });

  it('derives partial vs full receipt', () => {
    expect(deriveReceiptStatus(5, 10)).toBe('partial_received');
    expect(deriveReceiptStatus(10, 10)).toBe('received');
  });
});
