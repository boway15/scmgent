/**
 * Smoke: verify export wide table has fee 总/承担 pairs against a real batch.
 * Usage: pnpm exec tsx server/scripts/verify-fob-export-fee-pairs.ts [batchId]
 */
import { eq } from 'drizzle-orm';
import {
  db,
  fobSettlementBatches,
  fobSettlementAllocations,
  fobTruckingBillItems,
  fobFreightBillItems,
  fobContainerMerchantStats,
  fobServiceProviders,
} from '@scm/db';
import { buildTotalBillWideExportAoa } from '../lib/fob-reconcile-export.js';
import { sortAllocationRows, type AllocationRow } from '../lib/fob-settlement.js';

const batchId = process.argv[2] ?? '960be997-0827-4b0a-800a-369168ad8c2b';

const [batch] = await db.select().from(fobSettlementBatches).where(eq(fobSettlementBatches.id, batchId));
if (!batch) {
  console.error('batch not found', batchId);
  process.exit(2);
}

const [provider] = await db
  .select()
  .from(fobServiceProviders)
  .where(eq(fobServiceProviders.id, batch.serviceProviderId));

const [allocationRows, truckingItems, freightItems, containerStats] = await Promise.all([
  db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
  db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
  db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
  db.select().from(fobContainerMerchantStats).where(eq(fobContainerMerchantStats.batchId, batchId)),
]);

if (!allocationRows.length) {
  console.error('no allocations', batch.batchNo);
  process.exit(3);
}

const allocations: AllocationRow[] = sortAllocationRows(
  allocationRows.map((a) => ({
    containerNo: a.containerNo,
    merchantCode: a.merchantCode,
    merchantName: a.merchantName,
    stage: a.stage,
    feeType: a.feeType,
    sourceBillType: a.sourceBillType as 'trucking' | 'freight',
    sourceBillItemId: a.sourceBillItemId ?? '',
    sourceRef: a.sourceRef ?? undefined,
    allocationMethod: a.allocationMethod,
    sourceAmountCny: Number(a.sourceAmountCny),
    merchantVolumeCbm: Number(a.merchantVolumeCbm),
    volumeRatio: Number(a.volumeRatio),
    ticketCount: a.ticketCount ?? undefined,
    ticketRatio: a.ticketRatio != null ? Number(a.ticketRatio) : undefined,
    allocatedAmountCny: Number(a.allocatedAmountCny),
    isTailAdjustment: a.isTailAdjustment,
  })),
);

const rows = buildTotalBillWideExportAoa({
  settlementType: batch.settlementType,
  allocations,
  providerName: provider?.name ?? '',
  truckingItems,
  freightItems,
  containerStats,
});

const header = (rows[0] ?? []) as string[];
const sampleFeePairs = header
  .filter((h) => typeof h === 'string' && (h.endsWith('-总') || h.endsWith('-承担')))
  .slice(0, 8);

const probe =
  batch.settlementType === 'freight'
    ? { total: 'ORC-总', borne: 'ORC-承担', bare: 'ORC' }
    : { total: '拖车费-总', borne: '拖车费-承担', bare: '拖车费' };

const checks = {
  batchNo: batch.batchNo,
  settlementType: batch.settlementType,
  allocationCount: allocations.length,
  rowCount: rows.length - 1,
  hasFeeTotal: header.includes(probe.total),
  hasFeeBorne: header.includes(probe.borne),
  hasBareFee: header.includes(probe.bare),
  hasAppendTotal: header.includes('合计金额'),
  hasAppendBorne: header.includes('承担金额'),
  sampleFeePairs,
};

const data = (rows[1] ?? []) as unknown[];
const feeTotalIdx = header.indexOf(probe.total);
const feeBorneIdx = header.indexOf(probe.borne);
const merchantIdx = header.indexOf('承担工厂/主体');

console.log(
  JSON.stringify(
    {
      ...checks,
      firstRowFeeTotal: feeTotalIdx >= 0 ? data[feeTotalIdx] : null,
      firstRowFeeBorne: feeBorneIdx >= 0 ? data[feeBorneIdx] : null,
      merchant: merchantIdx >= 0 ? data[merchantIdx] : null,
    },
    null,
    2,
  ),
);

const ok = checks.hasFeeTotal && checks.hasFeeBorne && !checks.hasBareFee && checks.hasAppendTotal;
process.exit(ok ? 0 : 1);
