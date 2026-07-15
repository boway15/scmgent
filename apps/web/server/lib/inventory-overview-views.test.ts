import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getViewColumnIds, projectTurnoverExtras } from './inventory-overview-views.js';
import { INVENTORY_OVERVIEW_COLUMN_BY_ID } from './inventory-turnover-snapshot.js';

describe('inventory-overview-views', () => {
  it('replenish view columns are valid catalog ids', () => {
    const ids = getViewColumnIds('replenish');
    assert.ok(ids.length >= 18 && ids.length <= 36);
    for (const id of ids) {
      assert.ok(INVENTORY_OVERVIEW_COLUMN_BY_ID.has(id), `unknown column: ${id}`);
    }
    assert.equal(ids[0], '品类');
    assert.equal(ids[1], 'SKU');
    assert.ok(ids.includes('replenishLight'));
    assert.ok(!ids.includes('updatedAt'));
    assert.ok(!ids.includes('dataSource'));
    assert.equal(ids.at(-1), 'inventoryRecordedDate');
    assert.equal(ids.at(-2), 'ai');
    assert.equal(ids.at(-3), 'replenishLight');
  });

  it('excel_full view includes all sheet headers', () => {
    const ids = getViewColumnIds('excel_full');
    assert.ok(ids.length >= 200);
    assert.ok(ids.includes('近30天断货天数'));
  });

  it('projects turnover extras by column ids', () => {
    const projected = projectTurnoverExtras(
      { SKU: '1', 海外仓库存_美东: '2', 全链条合计库存: '3' },
      ['SKU', '海外仓库存_美东'],
    );
    assert.deepEqual(projected, { SKU: '1', 海外仓库存_美东: '2' });
  });
});
