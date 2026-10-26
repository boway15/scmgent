import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffSuggestions, overlayDraft } from './simulate.js';

describe('overlayDraft', () => {
  it('replaces active set of same scope', () => {
    const out = overlayDraft(
      [
        { id: 'a', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 30 }, version: 1 },
        { id: 'b', scopeType: 'warehouse', scopeValue: 'UK', params: {}, version: 1 },
      ],
      { id: 'd', scopeType: 'global', scopeValue: '*', params: { singleCoverDays: 45 }, version: 2 },
    );
    assert.deepEqual(out.map((s) => s.id).sort(), ['b', 'd']);
  });
});

describe('diffSuggestions', () => {
  it('reports changed, added and removed rows only', () => {
    const row = (sku: string, qty: number) => ({
      skuCode: sku,
      warehouseCode: 'NETWORK',
      suggestedQty: qty,
      suggestedDate: '2026-10-26',
      healthStatus: 'red',
      needsManualConfirm: false,
    });
    const out = diffSuggestions([row('A', 10), row('B', 20), row('C', 5)], [row('A', 10), row('B', 40), row('D', 7)]);
    assert.deepEqual(out.map((r) => r.skuCode), ['B', 'C', 'D']);
    assert.equal(out[1].after, null);
    assert.equal(out[2].before, null);
  });
});
