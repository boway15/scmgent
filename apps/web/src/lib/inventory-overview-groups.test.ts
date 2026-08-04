import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferOverviewColumnGroup,
  OVERVIEW_COLUMN_GROUPS,
  orderColumnGroups,
} from './inventory-overview-groups.js';

describe('inventory-overview-groups', () => {
  it('uses three top-level groups only', () => {
    assert.deepEqual([...OVERVIEW_COLUMN_GROUPS], ['主数据', '库存数据', '销售与预测']);
  });

  it('maps sales share fields to 销售与预测', () => {
    assert.equal(inferOverviewColumnGroup('美东'), '销售与预测');
    assert.equal(inferOverviewColumnGroup('平台仓_欧'), '销售与预测');
    assert.equal(inferOverviewColumnGroup('30天销量'), '销售与预测');
    assert.equal(inferOverviewColumnGroup('本月预测日均销量'), '销售与预测');
  });

  it('maps inventory-related fields to 库存数据', () => {
    assert.equal(inferOverviewColumnGroup('海外仓在库'), '库存数据');
    assert.equal(inferOverviewColumnGroup('供应商订单'), '库存数据');
    assert.equal(inferOverviewColumnGroup('预下单'), '库存数据');
    assert.equal(
      inferOverviewColumnGroup('预计10天内|10-20天|超20天上架数量'),
      '库存数据',
    );
    assert.equal(inferOverviewColumnGroup('预计海外周转天数'), '库存数据');
    assert.equal(inferOverviewColumnGroup('预计海外断货天数'), '库存数据');
  });

  it('maps master / packing / margin to 主数据', () => {
    assert.equal(inferOverviewColumnGroup('SKU'), '主数据');
    assert.equal(inferOverviewColumnGroup('包装长宽高cm'), '主数据');
    assert.equal(inferOverviewColumnGroup('近30天毛利率'), '主数据');
  });

  it('orders the three groups for column picker', () => {
    const ordered = orderColumnGroups([
      ['销售与预测', []],
      ['主数据', []],
      ['库存数据', []],
    ]);
    assert.deepEqual(
      ordered.map(([g]) => g),
      ['主数据', '库存数据', '销售与预测'],
    );
  });
});
