import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_INVENTORY_QUERY_TABLE_ID,
  getInventoryQueryBitableConfig,
} from './inventory-query-feishu-pull.js';

describe('inventory-query-feishu-pull config', () => {
  it('defaults table id to the known Feishu detail table', () => {
    const prev = process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY;
    delete process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY;
    try {
      const config = getInventoryQueryBitableConfig();
      assert.equal(config.tableId, DEFAULT_INVENTORY_QUERY_TABLE_ID);
      assert.equal(config.tableId, 'tblubb08s6pe6DXI');
    } finally {
      if (prev == null) delete process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY;
      else process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY = prev;
    }
  });

  it('allows env override for table id', () => {
    const prev = process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY;
    process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY = 'tblCustom123';
    try {
      assert.equal(getInventoryQueryBitableConfig().tableId, 'tblCustom123');
    } finally {
      if (prev == null) delete process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY;
      else process.env.FEISHU_BITABLE_TABLE_INVENTORY_QUERY = prev;
    }
  });
});
