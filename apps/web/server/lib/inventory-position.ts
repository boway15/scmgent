import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  inventoryRecords,
  pmcPlanItems,
  pmcPlans,
  purchaseDrafts,
} from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import { normalizePurchaseDraftStatus } from './purchase-draft-lifecycle.js';

export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';

/** 补货 / 健康 / 规划主路径：与库存总览同源，仅读 inventory_records，不叠加 purchase_drafts */
export const PLANNING_INVENTORY_DEDUPE_MODE: InventoryDedupeMode = 'snapshot_only';

export type InventoryPositionBucket =
  | 'available'
  | 'inProduction'
  | 'inTransit'
  | 'confirmedOpen'
  | 'reserved'
  | 'backorder';

export type InventoryPositionSource = {
  source: 'snapshot' | 'purchase_draft';
  bucket: InventoryPositionBucket;
  qty: number;
  draftId?: string;
  atRisk?: boolean;
};

export type InventoryPositionBreakdown = {
  qtyAvailable: number;
  qtyInProduction: number;
  qtyInTransit: number;
  qtyConfirmedOpen: number;
  qtyReserved: number;
  qtyBackorder: number;
  effectiveQty: number;
  sources: InventoryPositionSource[];
  dedupeMode: InventoryDedupeMode;
  unassignedOpenQty: number;
};

export type DraftOpenLine = {
  draftId: string;
  status: string;
  openQty: number;
  warehouseCode: string | null;
  atRisk?: boolean;
};

export function buildInventoryPositionMetrics(position: InventoryPositionBreakdown) {
  return {
    inventoryPosition: {
      effectiveQty: position.effectiveQty,
      qtyAvailable: position.qtyAvailable,
      qtyInProduction: position.qtyInProduction,
      qtyInTransit: position.qtyInTransit,
      qtyConfirmedOpen: position.qtyConfirmedOpen,
      qtyReserved: position.qtyReserved,
      dedupeMode: position.dedupeMode,
      unassignedOpenQty: position.unassignedOpenQty,
      sources: position.sources,
    },
  };
}

export function effectiveQtyWithProductionFallback(
  positions: Array<Pick<InventoryPositionBreakdown, 'effectiveQty' | 'qtyInProduction'>>,
  fallbackInProductionQty: number,
): number {
  const total = positions.reduce((sum, position) => sum + position.effectiveQty, 0);
  const productionFromWarehouses = positions.reduce(
    (sum, position) => sum + position.qtyInProduction,
    0,
  );
  return productionFromWarehouses <= 0 && fallbackInProductionQty > 0
    ? total + fallbackInProductionQty
    : total;
}

type InventoryPositionSnapshot = {
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
};

export function normalizeSnapshotForWarehouse(
  snapshot: InventoryPositionSnapshot,
  warehouseCode: string,
): InventoryPositionSnapshot {
  if (warehouseCode === IN_PRODUCTION_WAREHOUSE) {
    return {
      qtyAvailable: 0,
      qtyInTransit: 0,
      qtyInProduction: snapshot.qtyInProduction,
      qtyReserved: 0,
    };
  }

  return {
    ...snapshot,
    qtyInProduction: 0,
  };
}

export function openDraftQty(qty: number, receivedQty: number): number {
  return Math.max(0, (qty ?? 0) - (receivedQty ?? 0));
}

export function mapDraftStatusToBucket(status: string): InventoryPositionBucket | null {
  switch (status) {
    case 'draft':
    case 'confirmed':
    case 'exception':
      return 'confirmedOpen';
    case 'in_production':
    case 'ready_to_ship':
      return 'inProduction';
    case 'in_transit':
    case 'partial_received':
      return 'inTransit';
    default:
      return null;
  }
}

export function aggregateDraftBucketsForWarehouse(
  lines: DraftOpenLine[],
  warehouseCode: string,
): {
  draftBuckets: { inProduction: number; inTransit: number; confirmedOpen: number };
  sources: InventoryPositionSource[];
  unassignedOpenQty: number;
} {
  const draftBuckets = { inProduction: 0, inTransit: 0, confirmedOpen: 0 };
  const sources: InventoryPositionSource[] = [];
  let unassignedOpenQty = 0;

  for (const line of lines) {
    if (line.openQty <= 0) continue;
    const status = normalizePurchaseDraftStatus(line.status);
    const bucket = mapDraftStatusToBucket(status);
    if (!bucket) continue;

    if (line.warehouseCode == null) {
      unassignedOpenQty += line.openQty;
      continue;
    }
    if (line.warehouseCode !== warehouseCode) continue;
    if (
      bucket !== 'inProduction' &&
      bucket !== 'inTransit' &&
      bucket !== 'confirmedOpen'
    ) {
      continue;
    }

    draftBuckets[bucket] += line.openQty;
    sources.push({
      source: 'purchase_draft',
      bucket,
      qty: line.openQty,
      draftId: line.draftId,
      atRisk: status === 'exception' ? true : line.atRisk,
    });
  }

  return { draftBuckets, sources, unassignedOpenQty };
}

export function mergeInventoryPosition(input: {
  dedupeMode?: InventoryDedupeMode;
  snapshot: {
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
  };
  draftBuckets: {
    inProduction: number;
    inTransit: number;
    confirmedOpen: number;
  };
  sources?: InventoryPositionSource[];
  unassignedOpenQty?: number;
}): InventoryPositionBreakdown {
  const dedupeMode = input.dedupeMode ?? 'drafts_fill_gap';
  const s = input.snapshot;
  const d = input.draftBuckets;

  let qtyInProduction = s.qtyInProduction;
  let qtyInTransit = s.qtyInTransit;
  let qtyConfirmedOpen = 0;

  if (dedupeMode === 'snapshot_only') {
    // drafts ignored for bucket totals
  } else if (dedupeMode === 'sum_both') {
    qtyInProduction += d.inProduction;
    qtyInTransit += d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  } else {
    // drafts_fill_gap
    if (qtyInProduction <= 0) qtyInProduction = d.inProduction;
    if (qtyInTransit <= 0) qtyInTransit = d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  }

  const qtyAvailable = s.qtyAvailable;
  const qtyReserved = s.qtyReserved;
  const qtyBackorder = 0;
  const effectiveQty =
    qtyAvailable + qtyInProduction + qtyInTransit + qtyConfirmedOpen - qtyReserved - qtyBackorder;
  const sources =
    dedupeMode === 'drafts_fill_gap'
      ? (input.sources ?? []).filter((source) => {
          if (source.source !== 'purchase_draft') return true;
          if (source.bucket === 'inProduction') return s.qtyInProduction <= 0;
          if (source.bucket === 'inTransit') return s.qtyInTransit <= 0;
          return true;
        })
      : (input.sources ?? []);

  return {
    qtyAvailable,
    qtyInProduction,
    qtyInTransit,
    qtyConfirmedOpen,
    qtyReserved,
    qtyBackorder,
    effectiveQty,
    sources,
    dedupeMode,
    unassignedOpenQty: input.unassignedOpenQty ?? 0,
  };
}

function snapshotSources(snapshot: {
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
}): InventoryPositionSource[] {
  const entries: Array<[InventoryPositionBucket, number]> = [
    ['available', snapshot.qtyAvailable],
    ['inTransit', snapshot.qtyInTransit],
    ['inProduction', snapshot.qtyInProduction],
    ['reserved', snapshot.qtyReserved],
  ];
  return entries
    .filter(([, qty]) => qty !== 0)
    .map(([bucket, qty]) => ({ source: 'snapshot', bucket, qty }));
}

/** 仅用最新 inventory_records 快照构建仓位（规划/健康全量路径 snapshot_only，不查 drafts）。 */
export function resolveInventoryPositionFromSnapshot(params: {
  warehouseCode: string;
  qtyAvailable?: number | null;
  qtyInTransit?: number | null;
  qtyInProduction?: number | null;
  qtyReserved?: number | null;
  dedupeMode?: InventoryDedupeMode;
}): InventoryPositionBreakdown {
  const snapshot = normalizeSnapshotForWarehouse(
    {
      qtyAvailable: params.qtyAvailable ?? 0,
      qtyInTransit: params.qtyInTransit ?? 0,
      qtyInProduction: params.qtyInProduction ?? 0,
      qtyReserved: params.qtyReserved ?? 0,
    },
    params.warehouseCode,
  );

  return mergeInventoryPosition({
    dedupeMode: params.dedupeMode ?? PLANNING_INVENTORY_DEDUPE_MODE,
    snapshot,
    draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
    sources: snapshotSources(snapshot),
  });
}

export async function resolveInventoryPosition(params: {
  skuId: string;
  warehouseCode: string;
  dedupeMode?: InventoryDedupeMode;
}): Promise<InventoryPositionBreakdown> {
  const [record] = await db
    .select({
      qtyAvailable: inventoryRecords.qtyAvailable,
      qtyInTransit: inventoryRecords.qtyInTransit,
      qtyInProduction: inventoryRecords.qtyInProduction,
      qtyReserved: inventoryRecords.qtyReserved,
    })
    .from(inventoryRecords)
    .where(
      and(
        eq(inventoryRecords.skuId, params.skuId),
        eq(inventoryRecords.warehouse, params.warehouseCode),
      ),
    )
    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
    .limit(1);

  const dedupeMode = params.dedupeMode ?? 'drafts_fill_gap';

  if (dedupeMode === 'snapshot_only' || params.warehouseCode === IN_PRODUCTION_WAREHOUSE) {
    return resolveInventoryPositionFromSnapshot({
      warehouseCode: params.warehouseCode,
      qtyAvailable: record?.qtyAvailable,
      qtyInTransit: record?.qtyInTransit,
      qtyInProduction: record?.qtyInProduction,
      qtyReserved: record?.qtyReserved,
      dedupeMode,
    });
  }

  const snapshot = normalizeSnapshotForWarehouse(
    {
      qtyAvailable: record?.qtyAvailable ?? 0,
      qtyInTransit: record?.qtyInTransit ?? 0,
      qtyInProduction: record?.qtyInProduction ?? 0,
      qtyReserved: record?.qtyReserved ?? 0,
    },
    params.warehouseCode,
  );

  const draftRows = await db
    .select({
      id: purchaseDrafts.id,
      status: purchaseDrafts.status,
      qty: purchaseDrafts.qty,
      receivedQty: purchaseDrafts.receivedQty,
      itemWarehouseCode: pmcPlanItems.warehouseCode,
      planWarehouseCode: pmcPlans.targetWarehouseCode,
    })
    .from(purchaseDrafts)
    .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
    .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
    .where(eq(purchaseDrafts.skuId, params.skuId));

  const draftLines: DraftOpenLine[] = draftRows.map((row) => ({
    draftId: row.id,
    status: row.status,
    openQty: openDraftQty(row.qty, row.receivedQty),
    warehouseCode: row.itemWarehouseCode ?? row.planWarehouseCode,
  }));
  const aggregated = aggregateDraftBucketsForWarehouse(draftLines, params.warehouseCode);

  return mergeInventoryPosition({
    dedupeMode,
    snapshot,
    draftBuckets: aggregated.draftBuckets,
    sources: [...snapshotSources(snapshot), ...aggregated.sources],
    unassignedOpenQty: aggregated.unassignedOpenQty,
  });
}
