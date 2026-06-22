import { eq, and } from 'drizzle-orm';
import { db, fobMerchantShipments, fobContainerMerchantStats, fobFeeAllocationRules, fobTruckingBillItems, fobFreightBillItems, } from '../_db/index.js';
import { buildContainerMerchantStats } from './fob-container-stats.js';
import { computeContainerMatch } from './fob-container-match.js';
import { matchAllocationRule, effectiveBillAmount } from './fob-fee-rules.js';
/** 体积导入时标记「货柜内无 FOB」的占位主体编码 */
export const FOB_NON_FOB_MARKER = '__NON_FOB__';
export function isNonFobMarkerShipment(merchantCode) {
    return merchantCode === FOB_NON_FOB_MARKER;
}
export function partitionVolumeShipments(shipments) {
    const nonFobContainers = [
        ...new Set(shipments
            .filter((s) => isNonFobMarkerShipment(s.merchantCode))
            .map((s) => s.containerNo)),
    ].sort();
    const volumeContainers = [
        ...new Set(shipments
            .filter((s) => !isNonFobMarkerShipment(s.merchantCode))
            .map((s) => s.containerNo)),
    ].sort();
    return { volumeContainers, nonFobContainers };
}
export function computeMatchFromShipments(shipments, billContainers) {
    const { volumeContainers, nonFobContainers } = partitionVolumeShipments(shipments);
    return computeContainerMatch(volumeContainers, billContainers, { nonFobContainers });
}
export async function loadActiveFeeRules() {
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
export async function rebuildContainerMerchantStats(batchId) {
    const shipments = await db
        .select()
        .from(fobMerchantShipments)
        .where(eq(fobMerchantShipments.batchId, batchId));
    const stats = buildContainerMerchantStats(shipments
        .filter((s) => !isNonFobMarkerShipment(s.merchantCode))
        .map((s) => ({
        merchantCode: s.merchantCode,
        merchantName: s.merchantName,
        containerNo: s.containerNo,
        skuCode: s.skuCode,
        volumeCbm: Number(s.volumeCbm),
    })));
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
export function resolveRuleForBillItem(rules, feeType, sourceBillType, remark, amountCny, assignedMerchantCode) {
    const matched = matchAllocationRule(feeType, sourceBillType, rules, remark, amountCny);
    return {
        allocationMethod: matched.allocationMethod,
        isException: matched.isException,
        exceptionStatus: matched.isException ? 'pending' : null,
        exceptionReason: matched.exceptionReason,
        assignedMerchantCode: assignedMerchantCode ?? null,
        stage: matched.stage,
    };
}
export async function countPendingExceptions(batchId) {
    const [trucking, freight] = await Promise.all([
        db
            .select({ id: fobTruckingBillItems.id })
            .from(fobTruckingBillItems)
            .where(and(eq(fobTruckingBillItems.batchId, batchId), eq(fobTruckingBillItems.isException, true), eq(fobTruckingBillItems.exceptionStatus, 'pending'))),
        db
            .select({ id: fobFreightBillItems.id })
            .from(fobFreightBillItems)
            .where(and(eq(fobFreightBillItems.batchId, batchId), eq(fobFreightBillItems.isException, true), eq(fobFreightBillItems.exceptionStatus, 'pending'))),
    ]);
    return trucking.length + freight.length;
}
export { effectiveBillAmount };
