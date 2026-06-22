import assert from 'node:assert/strict';
import {
  buildMerchantBillWideExportAoa,
  buildMerchantExportFileName,
  buildReconcileTieredTableAoa,
  buildReconcileWideTableAoa,
  buildTotalBillWideExportAoa,
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
assert.deepEqual(table[0], ['柜号', '工厂/主体名称', '体积m³', '合计', '拖车费', '港杂费']);
assert.deepEqual(table[1], ['CNTR1', '工厂A', 10, 600, 600, 0]);
assert.deepEqual(table[2], ['CNTR1', '工厂B', 5, 400, 400, 0]);

const merchantTable = buildReconcileWideTableAoa(allocations, feeRules, 'M1');
assert.equal(merchantTable.length, 2);

assert.equal(buildMerchantExportFileName('工厂 A', 'M1', '2026-06'), '工厂_A2026-06.xlsx');
assert.equal(sanitizeExportFileName('a/b:c'), 'a_b_c');

const tiered = buildReconcileTieredTableAoa({
  allocations,
  meta: {
    batchNo: 'FOB-202606-001',
    settlementPeriod: '2026-06',
    settlementTypeLabel: '拖车分账',
    providerName: '森威',
  },
  merchantFilter: 'M1',
  payment: { paymentStatus: 'unpaid', remark: null },
});
assert.equal(tiered[2][0], '汇总');
assert.equal(tiered[2][1], 'CNTR1');
assert.equal(tiered[2][5], 600);
assert.equal(tiered[3][0], '明细');

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

{
  const wide = buildMerchantBillWideExportAoa({
    settlementType: 'trucking',
    allocations,
    merchantCode: 'M1',
    providerName: '森威物流',
    truckingItems: [
      {
        containerNo: 'CNTR1',
        internalNo: 'BIZ001',
        blNo: 'BL001',
        loadAddress: '青岛',
        shipDate: '2026-06-01',
        feeType: '拖车费',
        amountCny: 1000,
      },
    ],
    freightItems: [],
    containerStats: [
      { containerNo: 'CNTR1', merchantCode: 'M1', merchantName: '工厂A', volumeCbm: 10 },
      { containerNo: 'CNTR1', merchantCode: 'M2', merchantName: '工厂B', volumeCbm: 5 },
    ],
  });
  assert.equal(wide.length, 2);
  assert.equal(wide[0]?.[0], '货柜号');
  assert.equal(wide[0]?.includes('合计金额'), true);
  assert.equal(wide[0]?.includes('承担金额'), true);
  assert.equal(wide[0]?.includes('收款公司名称'), true);
  const dataRow = wide[1] as unknown[];
  assert.equal(dataRow[0], 'CNTR1');
  assert.equal(dataRow[1], 'BIZ001');
  assert.equal(dataRow[dataRow.length - 1], '森威物流');
  const totalAmountIdx = wide[0]!.indexOf('合计金额');
  const allocatedIdx = wide[0]!.indexOf('承担金额');
  const totalVolumeIdx = wide[0]!.indexOf('总体积');
  const merchantVolumeIdx = wide[0]!.indexOf('承担体积');
  const ratioIdx = wide[0]!.indexOf('体积占比');
  const merchantIdx = wide[0]!.indexOf('承担工厂/主体');
  assert.equal(dataRow[totalAmountIdx], 1500);
  assert.equal(dataRow[allocatedIdx], 600);
  assert.equal(dataRow[totalVolumeIdx], 15);
  assert.equal(dataRow[merchantVolumeIdx], 10);
  assert.equal(dataRow[ratioIdx], round4(10 / 15));
  assert.equal(dataRow[merchantIdx], '工厂A');
}

{
  const sharedParams = {
    settlementType: 'trucking' as const,
    allocations,
    providerName: '森威物流',
    truckingItems: [
      {
        containerNo: 'CNTR1',
        internalNo: 'BIZ001',
        blNo: 'BL001',
        loadAddress: '青岛',
        shipDate: '2026-06-01',
        feeType: '拖车费',
        amountCny: 1000,
      },
    ],
    freightItems: [],
    containerStats: [
      { containerNo: 'CNTR1', merchantCode: 'M1', merchantName: '工厂A', volumeCbm: 10 },
      { containerNo: 'CNTR1', merchantCode: 'M2', merchantName: '工厂B', volumeCbm: 5 },
    ],
  };

  const m1Rows = buildMerchantBillWideExportAoa({ ...sharedParams, merchantCode: 'M1' });
  const m2Rows = buildMerchantBillWideExportAoa({ ...sharedParams, merchantCode: 'M2' });
  const totalRows = buildTotalBillWideExportAoa(sharedParams);

  assert.equal(totalRows.length, 1 + (m1Rows.length - 1) + (m2Rows.length - 1));
  assert.deepEqual(totalRows[0], m1Rows[0]);
  assert.deepEqual(totalRows[1], m1Rows[1]);
  assert.deepEqual(totalRows[2], m2Rows[1]);
  const merchantIdx = totalRows[0]!.indexOf('承担工厂/主体');
  assert.equal((totalRows[1] as unknown[])[merchantIdx], '工厂A');
  assert.equal((totalRows[2] as unknown[])[merchantIdx], '工厂B');
}

console.log('fob-reconcile-export.test.ts ok');
