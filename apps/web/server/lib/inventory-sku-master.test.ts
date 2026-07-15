import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryEncodingMeta,
  inventoryImportMasterUnchanged,
  inventoryMasterToSkuColumns,
} from './inventory-sku-master.js';

describe('inventory-sku-master', () => {
  it('maps A:K fields to sku columns and inventoryMaster meta', () => {
    const cols = inventoryMasterToSkuColumns({
      skuCode: '100100201',
      category: '大件',
      lifecycle: '新品',
      name: '测试床',
      salesCountry: '美国',
      productCategory: 'D',
      merchantCode: 'M001',
      ownerName: '张三',
      developerName: '李四',
      merchantName: '顺德工厂',
      leadTimeDays: 50,
    });

    assert.equal(cols.category, '大件');
    assert.equal(cols.lifecycle, '新品');
    assert.equal(cols.salesCountry, '美国');
    assert.equal(cols.productCategory, 'D');
    assert.equal(cols.merchantCode, 'M001');
    assert.equal(cols.ownerName, '张三');
    assert.equal(cols.developerName, '李四');
    assert.equal(cols.merchantName, '顺德工厂');
    assert.equal(cols.leadTimeDays, 50);

    const meta = buildInventoryEncodingMeta(
      {
        skuCode: '100100201',
        category: '大件',
        lifecycle: '新品',
        name: '测试床',
        salesCountry: '美国',
        productCategory: 'D',
        merchantCode: 'M001',
        ownerName: '张三',
        developerName: '李四',
        merchantName: '顺德工厂',
        leadTimeDays: 50,
      },
      '100100201',
    );

    assert.equal(meta.masterDataSource, 'inventory');
    assert.deepEqual(meta.inventoryMaster, {
      品类: '大件',
      SKU: '100100201',
      生命周期: '新品',
      SKU名称: '测试床',
      销售国家: '美国',
      产品分类: 'D',
      供应商编码: 'M001',
      负责人: '张三',
      开发人员: '李四',
      供应商简称: '顺德工厂',
      采购周期: '50',
    });
  });

  it('detects unchanged inventory master data', () => {
    const encodingMeta = buildInventoryEncodingMeta(
      {
        skuCode: '100100201',
        category: '大件',
        lifecycle: '新品',
        name: '测试床',
        salesCountry: '美国',
        productCategory: 'D',
        merchantCode: 'M001',
        ownerName: '张三',
        developerName: '李四',
        merchantName: '顺德工厂',
        leadTimeDays: 50,
      },
      '100100201',
    );
    const nextMeta = {
      ...encodingMeta,
      turnoverSnapshot: { 品类: '大件', SKU: '100100201' },
    };

    assert.equal(
      inventoryImportMasterUnchanged(
        {
          name: '测试床',
          category: '大件',
          lifecycle: '新品',
          salesCountry: '美国',
          productCategory: 'D',
          ownerName: '张三',
          developerName: '李四',
          merchantCode: 'M001',
          merchantName: '顺德工厂',
          leadTimeDays: 50,
          unitCost: '99.5',
          encodingMeta: nextMeta,
        },
        {
          name: '测试床',
          category: '大件',
          lifecycle: '新品',
          salesCountry: '美国',
          productCategory: 'D',
          ownerName: '张三',
          developerName: '李四',
          merchantCode: 'M001',
          merchantName: '顺德工厂',
          leadTimeDays: 50,
          unitCost: '99.5',
          encodingMeta: nextMeta,
        },
      ),
      true,
    );

    assert.equal(
      inventoryImportMasterUnchanged(
        {
          name: '测试床',
          category: '大件',
          lifecycle: '新品',
          salesCountry: '美国',
          productCategory: 'D',
          ownerName: '张三',
          developerName: '李四',
          merchantCode: 'M001',
          merchantName: '顺德工厂',
          leadTimeDays: 50,
          unitCost: '99.5',
          encodingMeta: nextMeta,
        },
        {
          name: '测试床-改',
          category: '大件',
          lifecycle: '新品',
          salesCountry: '美国',
          productCategory: 'D',
          ownerName: '张三',
          developerName: '李四',
          merchantCode: 'M001',
          merchantName: '顺德工厂',
          leadTimeDays: 50,
          unitCost: '99.5',
          encodingMeta: nextMeta,
        },
      ),
      false,
    );
  });
});
