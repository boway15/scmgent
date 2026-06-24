import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** 与 nextFobBatchNo 内序号解析逻辑一致 */
function parseMaxSeq(prefix: string, batchNos: string[]): number {
  let maxSeq = 0;
  for (const batchNo of batchNos) {
    const tail = batchNo.slice(prefix.length);
    const n = parseInt(tail.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return maxSeq;
}

describe('nextFobBatchNo sequence', () => {
  const prefix = 'FOB-202606';

  it('uses max existing suffix + 1 when middle batch was deleted', () => {
    const existing = [`${prefix}0001`, `${prefix}0003`];
    assert.equal(parseMaxSeq(prefix, existing) + 1, 4);
  });

  it('parses dashed legacy batch numbers', () => {
    const existing = [`${prefix}-001`, `${prefix}0002`];
    assert.equal(parseMaxSeq(prefix, existing) + 1, 3);
  });
});
