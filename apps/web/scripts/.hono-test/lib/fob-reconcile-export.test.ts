import assert from 'node:assert/strict';
import {
  buildMerchantExportFileName,
  buildReconcileWideTableAoa,
  sanitizeExportFileName,
} from './fob-reconcile-export.js';
import type { AllocationRow } from './fob-settlement.js';

const feeRules = [
  {
    feeType: '拖车费',
    sourceBillType: 'trucking',
    matchPattern: null,
    priority: 100,
  },
  {
    feeType: '港杂费',
    sourceBillType: 'freight',
    matchPattern: null,
    priority: 90,
  },
];

const allocations: AllocationRow[] = [
  {
    containerNo: 'CNTR1',
    merchantCode: 'M1',
    merchantName: '工厂A',
    stage: 'trucking',
    feeType: '拖车费',
    sourceBillType: 'trucking',
    sourceBillItemId: 'a1',
    allocationMethod: 'by_volume',
    sourceAmountCny: 1000,
    merchantVolumeCbm: 10,
    volumeRatio: 1,
    allocatedAmountCny: 600,
    isTailAdjustment: false,
  },
  {
    containerNo: 'CNTR1',
    merchantCode: 'M1',
    merchantName: '工厂A',
    stage: 'freight',
    feeType: '港杂费',
    sourceBillType: 'freight',
    sourceBillItemId: 'b1',
    allocationMethod: 'by_volume',
    sourceAmountCny: 500,
    merchantVolumeCbm: 10,
    volumeRatio: 1,
    allocatedAmountCny: 0,
    isTailAdjustment: false,
  },
  {
    containerNo: 'CNTR1',
    merchantCode: 'M2',
    merchantName: '工厂B',
    stage: 'trucking',
    feeType: '拖车费',
    sourceBillType: 'trucking',
    sourceBillItemId: 'a1',
    allocationMethod: 'by_volume',
    sourceAmountCny: 1000,
    merchantVolumeCbm: 5,
    volumeRatio: 0.5,
    allocatedAmountCny: 400,
    isTailAdjustment: true,
  },
];

const table = buildReconcileWideTableAoa(allocations, feeRules);
assert.equal(table.length, 3);
assert.deepEqual(table[0], ['柜号', '主体名称', '体积m³', '合计', '拖车费', '港杂费']);
assert.deepEqual(table[1], ['CNTR1', '工厂A', 10, 600, 600, 0]);
assert.deepEqual(table[2], ['CNTR1', '工厂B', 5, 400, 400, 0]);

const merchantTable = buildReconcileWideTableAoa(allocations, feeRules, 'M1');
assert.equal(merchantTable.length, 2);

assert.equal(buildMerchantExportFileName('工厂 A', 'M1', '2026-06'), '工厂_A2026-06.xlsx');
assert.equal(sanitizeExportFileName('a/b:c'), 'a_b_c');

console.log('fob-reconcile-export.test.ts ok');
