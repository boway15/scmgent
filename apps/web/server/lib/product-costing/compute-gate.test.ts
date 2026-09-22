import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listComputeBlockers, resolveDisplaySummary } from './compute-gate.js';
import type { CostSummary } from './types.js';

const emptyLive: CostSummary = {
  materialAmount: 99,
  processAmount: 1,
  feeAmount: 2,
  totalAmount: 102,
  byCategory: [{ category: '板材', amount: 99, share: 1 }],
  feeItems: [],
  missingPriceCount: 1,
  missingQtyCount: 0,
  lines: [{ qtyGross: 1, effectiveUnitPrice: 99, lineAmount: 99 }],
};

describe('listComputeBlockers', () => {
  it('requires price and qty on every line', () => {
    assert.deepEqual(
      listComputeBlockers([
        { id: 'a', materialName: '侧板', qtyNet: 2, effectiveUnitPrice: 10 },
        { id: 'b', materialName: '滑轨', qtyNet: 0, effectiveUnitPrice: null },
      ]),
      [
        { lineId: 'b', materialName: '滑轨', reason: 'missing_qty' },
        { lineId: 'b', materialName: '滑轨', reason: 'missing_price' },
      ],
    );
  });

  it('skips 拉手 and loose 螺丝 but not 螺丝包', () => {
    assert.deepEqual(
      listComputeBlockers([
        { materialName: '侧板', qtyNet: 2, effectiveUnitPrice: 10 },
        { materialName: '拉手', qtyNet: 0, effectiveUnitPrice: null },
        { materialName: '螺丝', qtyNet: 4, effectiveUnitPrice: null },
        { materialName: '螺丝包', qtyNet: 1, effectiveUnitPrice: null },
        { materialName: '开料', category: '加工', qtyNet: 3, effectiveUnitPrice: null },
      ]),
      [{ lineId: undefined, materialName: '螺丝包', reason: 'missing_price' }],
    );
  });

  it('skips department footer rows that are not materials', () => {
    assert.deepEqual(
      listComputeBlockers([
        { id: 'a', materialName: '侧板', qtyNet: 2, effectiveUnitPrice: 10 },
        { id: 'd', materialName: '十七部', qtyNet: 0, effectiveUnitPrice: null },
        { id: 'e', materialName: '傲杰大件事业部', qtyNet: 1, effectiveUnitPrice: null },
      ]),
      [],
    );
  });

  it('skips decorative finish rows that are not cut materials', () => {
    assert.deepEqual(
      listComputeBlockers([
        { materialName: '侧板', qtyNet: 2, effectiveUnitPrice: 10 },
        { materialName: '胡桃色板', qtyNet: 0, effectiveUnitPrice: null },
        { materialName: '浮雕黑色板', qtyNet: 0, effectiveUnitPrice: 8 },
      ]),
      [],
    );
  });

  it('skips profile height annotations, cmf placeholders, and process standards', () => {
    assert.deepEqual(
      listComputeBlockers([
        { materialName: '踢脚线高度', spec: '60mm', qtyNet: 0, effectiveUnitPrice: null },
        { materialName: '菱形内嵌板', spec: '', qtyNet: 0, effectiveUnitPrice: null },
        {
          materialName: '油漆',
          category: '表面工艺',
          spec: '喷黑漆',
          unit: '项',
          qtyNet: 0,
          effectiveUnitPrice: null,
        },
        { materialName: '侧板', qtyNet: 2, effectiveUnitPrice: 10 },
      ]),
      [],
    );
  });

  it('blocks empty lists', () => {
    assert.deepEqual(listComputeBlockers([]), [{ materialName: '无材料行', reason: 'missing_qty' }]);
  });
});

describe('resolveDisplaySummary', () => {
  it('zeros amounts when there is no snapshot', () => {
    const result = resolveDisplaySummary({ snapshot: null, live: emptyLive });
    assert.equal(result.costStale, true);
    assert.equal(result.summary.totalAmount, 0);
    assert.equal(result.summary.missingPriceCount, 1);
  });
});
