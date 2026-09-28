import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCommercialStatusRaw } from './commercial-status.js';

describe('commercial-status-sync helpers', () => {
  it('extracts product status from procurement row shape', () => {
    const raw = extractCommercialStatusRaw({
      SKU: 'DJ001',
      产品状态: '停售',
      需求单号: 'X1',
    });
    assert.equal(raw, '停售');
  });

  it('extracts from inventory query payload shape', () => {
    const raw = extractCommercialStatusRaw({
      SKU: 'DJ002',
      产品状态: 'Active',
      可用库存: '1',
    });
    assert.equal(raw, 'Active');
  });
});
