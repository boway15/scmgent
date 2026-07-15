import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectDailySalesSkuStubs } from './ensure-sku-from-import.js';
import { expandFobInventoryRows, isFobInventoryFormat } from './fob-inventory-import.js';

describe('ensure-sku-from-import', () => {
  it('collects the best available daily sales stub per SKU code', () => {
    const stubs = collectDailySalesSkuStubs([
      {
        skuCode: 'DJ502952_1',
        skuName: 'Desk A',
        station: 'US',
        platformRaw: 'Amazon',
        firstOrderAt: '',
        category: 'Desks',
        saleDate: '2026-06-26',
        qtySold: 1,
      },
      {
        skuCode: 'DJ502952_1',
        skuName: 'Desk B',
        station: 'US',
        platformRaw: 'Amazon',
        firstOrderAt: '',
        category: 'Office',
        saleDate: '2026-06-25',
        qtySold: 2,
      },
    ]);

    assert.deepEqual(stubs.get('DJ502952_1'), {
      name: 'Desk B',
      category: 'Office',
    });
  });

  it('merges daily sales stubs when SKU code only differs by NUL bytes', () => {
    const stubs = collectDailySalesSkuStubs([
      {
        skuCode: 'WFDJ503588_1\0',
        skuName: 'Bed F',
        station: 'US',
        platformRaw: 'Amazon',
        firstOrderAt: '',
        category: 'Beds',
        saleDate: '2026-06-26',
        qtySold: 1,
      },
      {
        skuCode: 'WFDJ503588_1',
        skuName: 'Bed F updated',
        station: 'US',
        platformRaw: 'Amazon',
        firstOrderAt: '',
        category: 'Beds',
        saleDate: '2026-06-25',
        qtySold: 2,
      },
    ]);

    assert.equal(stubs.size, 1);
    assert.deepEqual(stubs.get('WFDJ503588_1'), {
      name: 'Bed F updated',
      category: 'Beds',
    });
  });
});

describe('fob-inventory-import', () => {
  it('detects FOB inventory export headers', () => {
    assert.equal(
      isFobInventoryFormat([
        {
          SKU: 'DJ502952_1',
          品名: 'Desk',
          品类: 'Office',
          区域: 'US',
          海外库存: '10',
          采购在途: '5',
        },
      ]),
      true,
    );
    assert.equal(
      isFobInventoryFormat([
        {
          sku_code: 'SKU-HM-001',
          warehouse: 'US-WEST',
          qty_available: '10',
        },
      ]),
      false,
    );
  });

  it('expands FOB inventory rows into warehouse snapshots', () => {
    const rows = expandFobInventoryRows([
      {
        SKU: 'DJ502952_1',
        品名: 'Desk',
        品类: 'Office',
        区域: 'US',
        海外库存: '10',
        FBA库存: '3',
        采购在途: '5',
        国内库存: '2',
        成本单价: '12.5',
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.skuCode, 'DJ502952_1');
    assert.equal(rows[0]?.qtyAvailable, 13);
    assert.ok(rows[0]?.turnoverSnapshot);
  });

  it('maps turnover inventory export columns (V:AD / BF:BN / BO:BS / CC / CD)', () => {
    const rows = expandFobInventoryRows([
      {
        sku: '100100201',
        sku名称: 'Sample Desk',
        品类: 'Furniture',
        销售国家: '美国',
        采购价: '99.5',
        海外仓库存_美东: '1',
        海外仓库存_美南: '0',
        海外仓库存_合计: '1',
        调拨在途_美东: '0',
        调拨在途_合计: '0',
        截止当月供应商订单数: '50',
        第二个月供应商订单数: '57',
        供应商订单合计: '107',
        预下单: '0',
        全链条合计库存: '108',
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.skuCode, '100100201');
    assert.equal(rows[0]?.qtyInProduction, 107);
    assert.equal(rows[0]?.qtyChainTotal, 108);
    assert.equal(rows[0]?.turnoverSnapshot?.['海外仓库存_美东'], '1');
    assert.ok(rows[0]?.warehouseBuckets?.some((b) => b.warehouse === 'US-EAST' && b.qtyAvailable === 1));
  });

  it('extracts turnover A:K master fields', () => {
    const rows = expandFobInventoryRows([
      {
        sku: 'DJ502952_1',
        品类: '大件',
        生命周期: '成熟期',
        sku名称: '测试床',
        销售国家: '美国',
        产品分类: '卧室-床',
        供应商编码: 'M001',
        负责人: '张三',
        开发人员: '李四',
        供应商简称: '顺德工厂',
        采购周期: '50',
        采购价: '120',
        海外仓库存_合计: '10',
        调拨在途_合计: '0',
        供应商订单合计: '5',
        预下单: '0',
        全链条合计库存: '15',
      },
    ]);

    assert.equal(rows[0]?.category, '大件');
    assert.equal(rows[0]?.lifecycle, '成熟期');
    assert.equal(rows[0]?.productCategory, '卧室-床');
    assert.equal(rows[0]?.merchantCode, 'M001');
    assert.equal(rows[0]?.ownerName, '张三');
    assert.equal(rows[0]?.developerName, '李四');
    assert.equal(rows[0]?.merchantName, '顺德工厂');
    assert.equal(rows[0]?.leadTimeDays, 50);
    assert.equal(rows[0]?.unitCost, '120');
  });

  it('stores pre-order separately from contracted supplier orders', () => {
    const rows = expandFobInventoryRows([
      {
        sku: '100100902',
        sku名称: 'Pre-order SKU',
        销售国家: '美国',
        海外仓库存_合计: '0',
        调拨在途_合计: '0',
        供应商订单合计: '0',
        预下单: '100',
        全链条合计库存: '100',
      },
    ]);

    assert.equal(rows[0]?.qtyInProduction, 0);
    assert.equal(rows[0]?.qtyPreOrder, 100);
  });
});
