import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getViewColumnIds, projectTurnoverExtras } from './inventory-overview-views.js';
import { INVENTORY_OVERVIEW_COLUMN_BY_ID } from './inventory-turnover-snapshot.js';
import { FEISHU_INVENTORY_TURNOVER_HEADERS } from './inventory-turnover-feishu-headers.js';

describe('inventory-overview-views', () => {
  it('replenish view columns are valid catalog ids', () => {
    const ids = getViewColumnIds('replenish');
    assert.ok(ids.length >= 15 && ids.length <= 36);
    for (const id of ids) {
      assert.ok(INVENTORY_OVERVIEW_COLUMN_BY_ID.has(id), `unknown column: ${id}`);
    }
    assert.equal(ids[0], '品类');
    assert.equal(ids[1], 'SKU');
    assert.ok(ids.includes('海外仓在库'));
    assert.ok(ids.includes('调拨在途合计'));
    assert.ok(ids.includes('供应商订单'));
    assert.ok(ids.includes('replenishLight'));
    assert.ok(!ids.includes('updatedAt'));
    assert.ok(!ids.includes('dataSource'));
    assert.equal(ids.at(-1), 'inventoryRecordedDate');
    assert.equal(ids.at(-2), 'ai');
    assert.equal(ids.at(-3), 'replenishLight');
  });

  it('warehouse view uses feishu sales-share region columns', () => {
    const ids = getViewColumnIds('warehouse');
    assert.ok(ids.includes('美东'));
    assert.ok(ids.includes('平台仓_欧'));
    assert.ok(!ids.includes('海外仓在库'));
    assert.ok(!ids.includes('海外仓库存_美东'));
  });

  it('feishu_full view includes all bitable headers', () => {
    const ids = getViewColumnIds('feishu_full');
    assert.ok(ids.length >= FEISHU_INVENTORY_TURNOVER_HEADERS.length);
    assert.ok(ids.includes('近30天断货天数'));
    assert.ok(ids.includes('海外仓在库'));
    assert.ok(ids.includes('预计海外周转天数'));
  });

  it('projects turnover extras by column ids', () => {
    const projected = projectTurnoverExtras(
      { SKU: '1', 美东: '2', 全链条合计库存: '3' },
      ['SKU', '美东'],
    );
    assert.deepEqual(projected, { SKU: '1', 美东: '2' });
  });
});
