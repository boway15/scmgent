import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOverviewCellValue } from './inventory-overview-cell-value.js';
import type { InventoryTurnoverOverviewItem } from './inventory-overview-service.js';

function baseItem(
  overrides: Partial<InventoryTurnoverOverviewItem> = {},
): InventoryTurnoverOverviewItem {
  return {
    skuId: 'sku-1',
    updatedAt: null,
    inventoryRecordedDate: null,
    turnoverSnapshotAt: null,
    dataSource: null,
    category: null,
    code: 'SKU-001',
    lifecycle: null,
    name: 'Test SKU',
    salesCountry: null,
    productCategory: null,
    merchantCode: null,
    ownerName: null,
    developerName: null,
    merchantName: null,
    leadTimeDays: null,
    unitCost: null,
    unit: 'pcs',
    qtyInProduction: 0,
    qtyPreOrder: 0,
    salesQty3d: 0,
    salesQty7d: 0,
    salesQty14d: 0,
    salesQty30d: 0,
    replenishLight: 'green',
    packDimensionsCm: null,
    volumeM3: null,
    grossWeightKg: null,
    turnoverExtras: {},
    warehouseStocks: [],
    ...overrides,
  };
}

describe('inventory-overview-cell-value', () => {
  it('reads packaging fields from top-level item fields', () => {
    const item = baseItem({
      packDimensionsCm: '80*60*40',
      volumeM3: '0.192',
      grossWeightKg: '25.5',
    });

    assert.equal(getOverviewCellValue(item, '包装长宽高cm'), '80*60*40');
    assert.equal(getOverviewCellValue(item, '体积（m3）'), '0.192');
    assert.equal(getOverviewCellValue(item, '毛重（Kg）'), '25.5');
  });

  it('prefers turnoverExtras over top-level packaging fields', () => {
    const item = baseItem({
      packDimensionsCm: '1*1*1',
      turnoverExtras: { '包装长宽高cm': '80*60*40' },
    });

    assert.equal(getOverviewCellValue(item, '包装长宽高cm'), '80*60*40');
  });
});
