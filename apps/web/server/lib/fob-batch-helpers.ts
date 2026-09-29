import { eq, and, like } from 'drizzle-orm';
import {
  db,
  fobMerchantShipments,
  fobContainerMerchantStats,
  fobFeeAllocationRules,
  fobTruckingBillItems,
  fobFreightBillItems,
  fobSettlementBatches,
  fobPorts,
} from '@scm/db';
import { buildContainerMerchantStats } from './fob-container-stats.js';
import { computeContainerMatch } from './fob-container-match.js';
import {
  matchAllocationRule,
  effectiveBillAmount,
  buildContainerOriginPortMap,
  type FeeRuleRow,
} from './fob-fee-rules.js';

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
    portId: r.portId,
  }));
}

/** 启用港口 name(trim) → id */
export async function loadActivePortNameToIdMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: fobPorts.id, name: fobPorts.name })
    .from(fobPorts)
    .where(eq(fobPorts.isActive, true));
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.name.trim(), r.id);
  return map;
}

/** 批次体积 → 柜号 → portId（起运港须已登记且同柜唯一） */
export async function loadBatchContainerPortIds(batchId: string): Promise<{
  byContainer: Map<string, string>;
  conflicts: string[];
  missingPortContainers: string[];
  unknownPortNames: string[];
}> {
  const shipments = await db
    .select({
      containerNo: fobMerchantShipments.containerNo,
      originPort: fobMerchantShipments.originPort,
      merchantCode: fobMerchantShipments.merchantCode,
    })
    .from(fobMerchantShipments)
    .where(eq(fobMerchantShipments.batchId, batchId));

  const { byContainer: nameByContainer, conflicts } = buildContainerOriginPortMap(shipments, {
    excludeNonFobMarker: FOB_NON_FOB_MARKER,
  });
  const portMap = await loadActivePortNameToIdMap();
  const byContainer = new Map<string, string>();
  const missingPortContainers: string[] = [];
  const unknownPortNames = new Set<string>();

  const volumeContainers = [
    ...new Set(
      shipments
        .filter((s) => !isNonFobMarkerShipment(s.merchantCode))
        .map((s) => s.containerNo),
    ),
  ];

  for (const containerNo of volumeContainers) {
    if (conflicts.includes(containerNo)) continue;
    const portName = nameByContainer.get(containerNo);
    if (!portName) {
      missingPortContainers.push(containerNo);
      continue;
    }
    const portId = portMap.get(portName);
    if (!portId) {
      unknownPortNames.add(portName);
      continue;
    }
    byContainer.set(containerNo, portId);
  }

  return {
    byContainer,
    conflicts,
    missingPortContainers: missingPortContainers.sort(),
    unknownPortNames: [...unknownPortNames].sort(),
  };
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
  portId?: string | null,
) {
  const matched = matchAllocationRule(
    feeType,
    sourceBillType,
    rules,
    remark,
    amountCny,
    portId,
  );
  return {
    allocationMethod: matched.allocationMethod,
    isException: matched.isException,
    exceptionStatus: matched.isException ? ('pending' as const) : null,
    exceptionReason: matched.exceptionReason,
    assignedMerchantCode: assignedMerchantCode ?? null,
    stage: matched.stage,
  };
}

type ReviewExceptionStatus = 'pending' | 'confirmed' | 'rejected';

function asExceptionStatus(value: string | null | undefined): ReviewExceptionStatus | null {
  if (value === 'pending' || value === 'confirmed' || value === 'rejected') return value;
  return null;
}

type BillItemRuleState = {
  feeType: string;
  remark?: string | null;
  amountCny: number;
  assignedMerchantCode?: string | null;
  isException: boolean;
  exceptionStatus?: string | null;
};

/** 核算 / 重新核算时按按钮当下的最新规则生成账单行口径；已确认/驳回只改分摊方式，不重开审核。 */
export function latestRulePatchForBillItem(
  rules: FeeRuleRow[],
  item: BillItemRuleState,
  sourceBillType: 'trucking' | 'freight',
  portId?: string | null,
) {
  const resolved = resolveRuleForBillItem(
    rules,
    item.feeType,
    sourceBillType,
    item.remark,
    item.amountCny,
    item.assignedMerchantCode,
    portId,
  );
  const reviewLocked = item.exceptionStatus === 'confirmed' || item.exceptionStatus === 'rejected';
  if (reviewLocked) {
    return {
      allocationMethod: resolved.allocationMethod,
      stage: resolved.stage,
      isException: item.isException,
      exceptionStatus: asExceptionStatus(item.exceptionStatus),
      assignedMerchantCode: item.assignedMerchantCode ?? null,
    };
  }
  return {
    allocationMethod: resolved.allocationMethod,
    stage: resolved.stage,
    isException: resolved.isException,
    exceptionStatus: resolved.exceptionStatus,
    assignedMerchantCode: resolved.assignedMerchantCode,
  };
}

export function pendingCountFromRulePatches(
  patches: Array<{ isException: boolean; exceptionStatus: ReviewExceptionStatus | null }>,
) {
  return patches.filter((p) => p.isException && p.exceptionStatus === 'pending').length;
}

type BillItemRulePatch = ReturnType<typeof latestRulePatchForBillItem>;

export type LatestFeeRulePreview = {
  skipped: boolean;
  pendingCount: number;
  trucking: Array<{ id: string; patch: BillItemRulePatch }>;
  freight: Array<{ id: string; patch: BillItemRulePatch }>;
};

/** 按当前规则预览账单口径，不写库。已确认批次 skipped。 */
export async function previewLatestFeeRulesForBatch(batchId: string): Promise<LatestFeeRulePreview> {
  const batch = await db
    .select({
      id: fobSettlementBatches.id,
      status: fobSettlementBatches.status,
    })
    .from(fobSettlementBatches)
    .where(eq(fobSettlementBatches.id, batchId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!batch || batch.status === 'confirmed') {
    return { skipped: true, pendingCount: 0, trucking: [], freight: [] };
  }

  const rules = await loadActiveFeeRules();
  const [trucking, freight] = await Promise.all([
    db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
    db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
  ]);
  const { byContainer: containerPortIds } = await loadBatchContainerPortIds(batchId);

  const truckingPatches = trucking.map((item) => ({
    id: item.id,
    patch: latestRulePatchForBillItem(
      rules,
      {
        feeType: item.feeType,
        remark: item.remark,
        amountCny: Number(item.amountCny),
        assignedMerchantCode: item.assignedMerchantCode,
        isException: item.isException,
        exceptionStatus: item.exceptionStatus,
      },
      'trucking',
      null,
    ),
  }));
  const freightPatches = freight.map((item) => ({
    id: item.id,
    patch: latestRulePatchForBillItem(
      rules,
      {
        feeType: item.feeType,
        remark: item.remark,
        amountCny: Number(item.amountCny),
        assignedMerchantCode: item.assignedMerchantCode,
        isException: item.isException,
        exceptionStatus: item.exceptionStatus,
      },
      'freight',
      containerPortIds.get(item.containerNo) ?? null,
    ),
  }));

  return {
    skipped: false,
    pendingCount: pendingCountFromRulePatches([
      ...truckingPatches.map((row) => row.patch),
      ...freightPatches.map((row) => row.patch),
    ]),
    trucking: truckingPatches,
    freight: freightPatches,
  };
}

export async function persistLatestFeeRulePatches(preview: LatestFeeRulePreview) {
  if (preview.skipped) return;
  for (const { id, patch } of preview.trucking) {
    await db
      .update(fobTruckingBillItems)
      .set({
        allocationMethod: patch.allocationMethod,
        isException: patch.isException,
        exceptionStatus: patch.exceptionStatus,
      })
      .where(eq(fobTruckingBillItems.id, id));
  }
  for (const { id, patch } of preview.freight) {
    await db
      .update(fobFreightBillItems)
      .set({
        allocationMethod: patch.allocationMethod,
        isException: patch.isException,
        exceptionStatus: patch.exceptionStatus,
        stage: patch.stage,
      })
      .where(eq(fobFreightBillItems.id, id));
  }
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

/** 按月递增批次号；取已有最大序号 +1，避免删除中间批次后 length+1 撞号 */
export async function nextFobBatchNo(): Promise<string> {
  const d = new Date();
  const prefix = `FOB-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rows = await db
    .select({ batchNo: fobSettlementBatches.batchNo })
    .from(fobSettlementBatches)
    .where(like(fobSettlementBatches.batchNo, `${prefix}%`));

  let maxSeq = 0;
  for (const row of rows) {
    const tail = row.batchNo.slice(prefix.length);
    const n = parseInt(tail.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }

  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}
