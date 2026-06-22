import assert from 'node:assert/strict';
import {
  allocateFees,
  allocateFeesByTicket,
  allocateFeesByVolume,
  allocateFeeFixed,
  allocateFeeManual,
  allocateFeeSingleMerchant,
  padMissingMerchantAllocations,
  reconcileAllocations,
  shouldPadMerchantPlaceholders,
} from './fob-settlement.js';
import { matchAllocationRule } from './fob-fee-rules.js';
import type { FeeLine } from './fob-settlement.js';

function fee(partial: Partial<FeeLine> & Pick<FeeLine, 'key' | 'containerNo' | 'feeType' | 'amountCny'>): FeeLine {
  return {
    stage: 'freight',
    sourceBillType: 'freight',
    allocationMethod: 'by_volume',
    ...partial,
  };
}

const merchants = [
  { merchantCode: 'M1', merchantName: 'M1', volumeCbm: 60, ticketCount: 1 },
  { merchantCode: 'M2', merchantName: 'M2', volumeCbm: 40, ticketCount: 1 },
];

// by_volume: 60/40 split of 1000
{
  const rows = allocateFeesByVolume(merchants, fee({
    key: 'f1',
    containerNo: 'CNTR1',
    feeType: '海运费',
    amountCny: 1000,
    allocationMethod: 'by_volume',
  }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].allocatedAmountCny, 600);
  assert.equal(rows[1].allocatedAmountCny, 400);
}

// by_ticket: 每主体 1 票，两主体均分 300
{
  const rows = allocateFeesByTicket(merchants, fee({
    key: 'f2',
    containerNo: 'CNTR1',
    feeType: '报关费',
    amountCny: 300,
    allocationMethod: 'by_ticket',
    stage: 'customs',
  }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].allocatedAmountCny, 150);
  assert.equal(rows[1].allocatedAmountCny, 150);
  assert.ok(Math.abs((rows[0].ticketRatio ?? 0) - 0.5) < 0.0001);
}

// manual: M1 承担全额，M2 默认 ¥0
{
  const rows = allocateFeeManual(merchants, fee({
    key: 'f3',
    containerNo: 'CNTR1',
    feeType: '异常费用',
    amountCny: 150,
    allocationMethod: 'manual',
    assignedMerchantCode: 'M1',
  }));
  assert.equal(rows.length, 2);
  const m1 = rows.find((r) => r.merchantCode === 'M1');
  const m2 = rows.find((r) => r.merchantCode === 'M2');
  assert.equal(m1?.allocatedAmountCny, 150);
  assert.equal(m2?.allocatedAmountCny, 0);
}

// manual without merchant: all merchants ¥0
{
  const rows = allocateFeeManual(merchants, fee({
    key: 'f3b',
    containerNo: 'CNTR1',
    feeType: '异常费用',
    amountCny: 150,
    allocationMethod: 'manual',
  }));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.allocatedAmountCny === 0));
}

// configured manual is not an import exception; allocates ¥0 rows for reconcile
{
  const rules = [
    {
      feeType: '改单费',
      sourceBillType: 'freight',
      allocationMethod: 'manual' as const,
      defaultStage: 'other' as const,
      priority: 10,
    },
    {
      feeType: '其他',
      sourceBillType: 'trucking',
      allocationMethod: 'manual' as const,
      defaultStage: 'other' as const,
      priority: 10,
    },
  ];
  const manualFreight = matchAllocationRule('改单费', 'freight', rules, null, 300);
  assert.equal(manualFreight.isException, false);
  assert.equal(manualFreight.allocationMethod, 'manual');

  const unconfigured = matchAllocationRule('茶水费', 'freight', rules, null, 100);
  assert.equal(unconfigured.isException, true);
  assert.equal(unconfigured.exceptionReason, 'unconfigured');

  const stats = new Map([['CNTR1', merchants]]);
  const { allocations } = allocateFees(stats, [
    fee({
      key: 'm1',
      containerNo: 'CNTR1',
      feeType: '改单费',
      amountCny: 300,
      allocationMethod: 'manual',
    }),
  ]);
  assert.equal(allocations.length, 2);
  assert.ok(allocations.every((r) => r.allocatedAmountCny === 0));
}

// pending exception: placeholder rows with ¥0 per merchant
{
  const stats = new Map([['CNTR1', merchants]]);
  const { allocations, warnings } = allocateFees(stats, [
    fee({
      key: 'f4',
      containerNo: 'CNTR1',
      feeType: '异常费用',
      amountCny: 200,
      allocationMethod: 'manual',
      isException: true,
      exceptionStatus: 'pending',
    }),
  ]);
  assert.equal(allocations.length, 2);
  assert.ok(allocations.every((r) => r.allocatedAmountCny === 0));
  assert.ok(!warnings.some((w) => w.includes('待异常审核')));
}

// reconcile balanced
{
  const feeLines: FeeLine[] = [
    fee({ key: 'a', containerNo: 'CNTR1', feeType: '海运费', amountCny: 1000, allocationMethod: 'by_volume' }),
  ];
  const { allocations } = allocateFees(new Map([['CNTR1', merchants]]), feeLines);
  const reconcile = reconcileAllocations(feeLines, allocations, 0);
  assert.equal(reconcile.billTotalCny, 1000);
  assert.equal(reconcile.allocationTotalCny, 1000);
  assert.equal(reconcile.diffCny, 0);
  assert.equal(reconcile.balanced, true);
}

// ticket stats: 柜+主体固定 1 票（多 Sku 行不叠加）
{
  const { buildContainerMerchantStats } = await import('./fob-container-stats.js');
  const stats = buildContainerMerchantStats([
    { merchantCode: 'A', merchantName: 'A', containerNo: 'C1', skuCode: 'S1', volumeCbm: 10 },
    { merchantCode: 'A', merchantName: 'A', containerNo: 'C1', skuCode: 'S2', volumeCbm: 5 },
    { merchantCode: 'B', merchantName: 'B', containerNo: 'C1', skuCode: 'S3', volumeCbm: 8 },
  ]);
  assert.equal(stats.length, 2);
  const a = stats.find((s) => s.merchantCode === 'A');
  const b = stats.find((s) => s.merchantCode === 'B');
  assert.equal(a?.volumeCbm, 15);
  assert.equal(a?.ticketCount, 1);
  assert.equal(b?.ticketCount, 1);
}

// fixed: single merchant gets 100%
{
  const rows = allocateFeeFixed(
    [{ merchantCode: 'M1', merchantName: 'M1', volumeCbm: 100, ticketCount: 1 }],
    fee({
      key: 'f5',
      containerNo: 'CNTR1',
      feeType: '压夜费',
      amountCny: 500,
      allocationMethod: 'fixed',
      stage: 'other',
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].merchantCode, 'M1');
  assert.equal(rows[0].allocatedAmountCny, 500);
}

// fixed: assigned merchant
{
  const rows = allocateFeeFixed(merchants, fee({
    key: 'f6',
    containerNo: 'CNTR1',
    feeType: '指定柜号',
    amountCny: 200,
    allocationMethod: 'fixed',
    assignedMerchantCode: 'M2',
    stage: 'other',
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].merchantCode, 'M2');
  assert.equal(rows[0].allocatedAmountCny, 200);
}

// fixed: multi merchant without assignment returns empty
{
  const rows = allocateFeeFixed(merchants, fee({
    key: 'f7',
    containerNo: 'CNTR1',
    feeType: '压夜费',
    amountCny: 300,
    allocationMethod: 'fixed',
    stage: 'other',
  }));
  assert.equal(rows.length, 0);
}

// fixed via allocateFees does not split by volume
{
  const stats = new Map([['CNTR1', merchants]]);
  const { allocations, warnings } = allocateFees(stats, [
    fee({
      key: 'f8',
      containerNo: 'CNTR1',
      feeType: '压夜费',
      amountCny: 400,
      allocationMethod: 'fixed',
      assignedMerchantCode: 'M1',
      stage: 'other',
    }),
  ]);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].allocatedAmountCny, 400);
  assert.ok(!warnings.some((w) => w.includes('暂按体积分摊')));
}

// rejected exception excluded from reconcile
{
  const feeLines: FeeLine[] = [
    fee({
      key: 'r1',
      containerNo: 'CNTR1',
      feeType: '异常费用',
      amountCny: 100,
      allocationMethod: 'manual',
      isException: true,
      exceptionStatus: 'rejected',
    }),
    fee({ key: 'r2', containerNo: 'CNTR1', feeType: '海运费', amountCny: 1000, allocationMethod: 'by_volume' }),
  ];
  const { allocations } = allocateFees(new Map([['CNTR1', merchants]]), feeLines);
  const reconcile = reconcileAllocations(feeLines, allocations, 0);
  assert.equal(reconcile.billTotalCny, 1000);
  assert.equal(reconcile.allocationTotalCny, 1000);
  assert.equal(reconcile.balanced, true);
}

// single merchant container: full amount regardless of manual rule
{
  const solo = [{ merchantCode: 'M1', merchantName: 'M1', volumeCbm: 10, ticketCount: 1 }];
  const stats = new Map([['CNTR1', solo]]);
  const { allocations } = allocateFees(stats, [
    fee({
      key: 'solo1',
      containerNo: 'CNTR1',
      feeType: '改单费',
      amountCny: 500,
      allocationMethod: 'manual',
    }),
    fee({
      key: 'solo2',
      containerNo: 'CNTR1',
      feeType: '拖车费',
      amountCny: 1200,
      allocationMethod: 'by_volume',
    }),
  ]);
  assert.equal(allocations.length, 2);
  assert.ok(allocations.every((r) => r.merchantCode === 'M1'));
  assert.equal(allocations.find((r) => r.feeType === '改单费')?.allocatedAmountCny, 500);
  assert.equal(allocations.find((r) => r.feeType === '拖车费')?.allocatedAmountCny, 1200);

  const row = allocateFeeSingleMerchant(solo[0], fee({
    key: 's',
    containerNo: 'CNTR1',
    feeType: '其他',
    amountCny: 88,
    allocationMethod: 'manual',
  }));
  assert.equal(row.length, 1);
  assert.equal(row[0].allocatedAmountCny, 88);
}

// fixed 仅一行且未平账时，应补齐柜内其他主体 ¥0
{
  const feeLine = fee({
    key: 'fx',
    containerNo: 'CNTR1',
    feeType: '指定柜号',
    amountCny: 500,
    allocationMethod: 'fixed',
    assignedMerchantCode: 'M1',
    stage: 'other',
  });
  const rows = allocateFeeFixed(merchants, feeLine);
  assert.equal(rows.length, 1);
  rows[0].allocatedAmountCny = 300;
  assert.ok(shouldPadMerchantPlaceholders(feeLine, rows));
  const padded = padMissingMerchantAllocations(merchants, feeLine, rows);
  assert.equal(padded.length, 2);
  assert.equal(padded.find((r) => r.merchantCode === 'M2')?.allocatedAmountCny, 0);
}

// 固定费用缺归属主体：生成各主体 ¥0 占位行
{
  const stats = new Map([['CNTR1', merchants]]);
  const { allocations } = allocateFees(stats, [
    fee({
      key: 'fx2',
      containerNo: 'CNTR1',
      feeType: '指定柜号',
      amountCny: 500,
      allocationMethod: 'fixed',
      stage: 'other',
    }),
  ]);
  assert.equal(allocations.length, 2);
  assert.ok(allocations.every((r) => r.allocatedAmountCny === 0));
}

console.log('fob-settlement.test.ts: all passed');
