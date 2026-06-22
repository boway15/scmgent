import { eq, and } from 'drizzle-orm';
import {
  db,
  fobMerchantShipments,
  fobContainerMerchantStats,
  fobFeeAllocationRules,
  fobTruckingBillItems,
  fobFreightBillItems,
} from '@scm/db';
import { buildContainerMerchantStats } from './fob-container-stats.js';
import { computeContainerMatch } from './fob-container-match.js';
import { matchAllocationRule, effectiveBillAmount, type FeeRuleRow } from './fob-fee-rules.js';

/** 体积导入时标记「货柜内无 FOB」的占位主体编码 */
export const FOB_NON_FOB_MARKER = '__NON_FOB__';

export function isNonFobMarkerShipment(merchantCode: string): boolean {
  return merchantCode === FOB_NON_FOB_MARKER;
}

export function partitionVolumeShipments(
  shipments: Array<{ merchantCode: string; containerNo: string }>,
) {
  const nonFobContainers = [
    ...new Set(
      shipments
        .filter((s) => isNonFobMarkerShipment(s.merchantCode))
        .map((s) => s.containerNo),
    ),
  ].sort();
  const volumeContainers = [
    ...new Set(
      shipments
        .filter((s) => !isNonFobMarkerShipment(s.merchantCode))
        .map((s) => s.containerNo),
    ),
  ].sort();
  return { volumeContainers, nonFobContainers };
}

export function computeMatchFromShipments(
  shipments: Array<{ merchantCode: string; containerNo: string }>,
  billContainers: Iterable<string>,
) {
  const { volumeContainers, nonFobContainers } = partitionVolumeShipments(shipments);
  return computeContainerMatch(volumeContainers, billContainers, { nonFobContainers });
}

export async function loadActiveFeeRules(): Promise<FeeRuleRow[]> {
  const rows = await db
    .select()
    .from(fobFeeAllocationRules)
    .where(eq(fobFeeAllocationRules.isActive, true));
  return rows.map((r) => ({
    feeType: r.feeType,
    sourceBillType: r.sourceBillType,
    matchPattern: r.matchPattern,
    allocationMethod: r.allocationMethod,
    defaultStage: r.defaultStage,
    priority: r.priority,
  }));
}

export async function rebuildContainerMerchantStats(batchId: string) {
  const shipments = await db
    .select()
    .from(fobMerchantShipments)
    .where(eq(fobMerchantShipments.batchId, batchId));

  const stats = buildContainerMerchantStats(
    shipments
      .filter((s) => !isNonFobMarkerShipment(s.merchantCode))
      .map((s) => ({
        merchantCode: s.merchantCode,
        merchantName: s.merchantName,
        containerNo: s.containerNo,
        skuCode: s.skuCode,
        volumeCbm: Number(s.volumeCbm),
      })),
  );

  await db.delete(fobContainerMerchantStats).where(eq(fobContainerMerchantStats.batchId, batchId));
  for (const s of stats) {
    await db.insert(fobContainerMerchantStats).values({
      batchId,
      containerNo: s.containerNo,
      merchantCode: s.merchantCode,
      merchantName: s.merchantName,
      volumeCbm: String(s.volumeCbm),
      ticketCount: s.ticketCount,
    });
  }

  return stats;
}

export function resolveRuleForBillItem(
  rules: FeeRuleRow[],
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  remark?: string | null,
  amountCny?: number,
  assignedMerchantCode?: string | null,
) {
  const matched = matchAllocationRule(feeType, sourceBillType, rules, remark, amountCny);
  return {
    allocationMethod: matched.allocationMethod,
    isException: matched.isException,
    exceptionStatus: matched.isException ? ('pending' as const) : null,
    exceptionReason: matched.exceptionReason,
    assignedMerchantCode: assignedMerchantCode ?? null,
    stage: matched.stage,
  };
}

export async function countPendingExceptions(batchId: string) {
  const [trucking, freight] = await Promise.all([
    db
      .select({ id: fobTruckingBillItems.id })
      .from(fobTruckingBillItems)
      .where(
        and(
          eq(fobTruckingBillItems.batchId, batchId),
          eq(fobTruckingBillItems.isException, true),
          eq(fobTruckingBillItems.exceptionStatus, 'pending'),
        ),
      ),
    db
      .select({ id: fobFreightBillItems.id })
      .from(fobFreightBillItems)
      .where(
        and(
          eq(fobFreightBillItems.batchId, batchId),
          eq(fobFreightBillItems.isException, true),
          eq(fobFreightBillItems.exceptionStatus, 'pending'),
        ),
      ),
  ]);
  return trucking.length + freight.length;
}

export { effectiveBillAmount };
