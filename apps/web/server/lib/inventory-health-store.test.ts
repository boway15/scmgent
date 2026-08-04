import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HEALTH_SNAPSHOT_INSERT_CHUNK,
  chunkRowsForInsert,
} from './inventory-health-store.js';

describe('inventory-health-store insert chunking', () => {
  it('keeps insert batches small enough to avoid call-stack overflow', () => {
    assert.equal(HEALTH_SNAPSHOT_INSERT_CHUNK, 500);
    assert.ok(HEALTH_SNAPSHOT_INSERT_CHUNK <= 1000);
  });

  it('splits ~SKU×warehouse health rows into fixed-size chunks', () => {
    // 9234 active SKUs × 9 warehouses ≈ 83106 rows（缺货预警真实量级）
    const rows = Array.from({ length: 83_106 }, (_, i) => i);
    const chunks = chunkRowsForInsert(rows, HEALTH_SNAPSHOT_INSERT_CHUNK);
    assert.equal(chunks.length, Math.ceil(83_106 / 500));
    assert.equal(chunks[0]?.length, 500);
    assert.equal(chunks.at(-1)?.length, 83_106 % 500);
    assert.equal(
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      83_106,
    );
  });
});
