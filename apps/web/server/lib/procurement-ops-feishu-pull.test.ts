import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROCUREMENT_OPS_TABLE_ID,
  getProcurementOpsBitableConfig,
} from './procurement-ops-feishu-pull.js';

describe('procurement-ops-feishu-pull config', () => {
  it('defaults table id when env unset', () => {
    const prev = process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS;
    delete process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS;
    try {
      const config = getProcurementOpsBitableConfig();
      assert.equal(config.tableId, DEFAULT_PROCUREMENT_OPS_TABLE_ID);
    } finally {
      if (prev == null) delete process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS;
      else process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS = prev;
    }
  });

  it('uses env table id when set', () => {
    const prev = process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS;
    process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS = 'tblCustom456';
    try {
      assert.equal(getProcurementOpsBitableConfig().tableId, 'tblCustom456');
    } finally {
      if (prev == null) delete process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS;
      else process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS = prev;
    }
  });
});
