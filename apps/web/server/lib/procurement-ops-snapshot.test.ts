import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertProcurementOpsSnapshotPublishable,
  keepProcurementOpsSnapshotItems,
} from './procurement-ops-snapshot.js';

describe('procurement-ops-snapshot', () => {
  it('keeps rows with sku and drops empty sku', () => {
    const result = keepProcurementOpsSnapshotItems([
      { skuCode: 'A', skuId: null, payload: { SKU: 'A' } },
      { skuCode: '  ', skuId: null, payload: {} },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.skuCode, 'A');
  });

  it('rejects empty publishes', () => {
    assert.throws(
      () => assertProcurementOpsSnapshotPublishable({ imported: 0, itemCount: 0 }),
      /没有可归档/,
    );
  });
});
