import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeFrozenLeftOffsets,
  leadingFreezeColumnIds,
  stickyColumnStyle,
} from './sticky-table-utils.js';

describe('leadingFreezeColumnIds', () => {
  it('freezes contiguous prefix through SKU', () => {
    assert.deepEqual(leadingFreezeColumnIds(['品类', 'SKU', '生命周期', 'SKU名称']), [
      '品类',
      'SKU',
    ]);
  });

  it('freezes first column when SKU missing', () => {
    assert.deepEqual(leadingFreezeColumnIds(['品类', '生命周期']), ['品类']);
  });

  it('freezes only SKU when it is first', () => {
    assert.deepEqual(leadingFreezeColumnIds(['SKU', '品类']), ['SKU']);
  });
});

describe('computeFrozenLeftOffsets', () => {
  it('accumulates widths for frozen prefix', () => {
    const widths = { 品类: 100, SKU: 120, 生命周期: 80 };
    const map = computeFrozenLeftOffsets(
      ['品类', 'SKU', '生命周期'],
      ['品类', 'SKU'],
      (id) => widths[id as keyof typeof widths],
    );
    assert.equal(map.get('品类'), 0);
    assert.equal(map.get('SKU'), 100);
    assert.equal(map.has('生命周期'), false);
  });
});

describe('stickyColumnStyle', () => {
  it('keeps header z-index above body frozen cells', () => {
    const header = stickyColumnStyle({
      width: 100,
      frozenLeft: 0,
      isHeader: true,
      stackIndex: 0,
    });
    const body = stickyColumnStyle({
      width: 100,
      frozenLeft: 0,
      isHeader: false,
      stackIndex: 0,
    });
    assert.ok((header.zIndex as number) > (body.zIndex as number));
    assert.equal(header.top, 0);
    assert.equal(header.position, 'sticky');
  });

  it('sets sticky top for non-frozen headers', () => {
    const header = stickyColumnStyle({ width: 100, isHeader: true });
    assert.equal(header.position, 'sticky');
    assert.equal(header.top, 0);
    assert.equal(header.zIndex, 40);
  });
});
