import { and, desc, eq } from 'drizzle-orm';
import { db, inventoryRecords, purchaseDrafts, skus } from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE, UNALLOCATED_TRANSIT_WAREHOUSE } from './inventory-constants.js';
import { normalizePurchaseDraftStatus } from './purchase-draft-lifecycle.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  type ShareParseResult,
} from './inventory-share-allocation.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';

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

function toInventoryPositionSnapshot(
  raw?: Partial<InventoryPositionSnapshot> | null,
): InventoryPositionSnapshot {
  return {
    qtyAvailable: raw?.qtyAvailable ?? 0,
    qtyInTransit: raw?.qtyInTransit ?? 0,
    qtyInProduction: raw?.qtyInProduction ?? 0,
    qtyReserved: raw?.qtyReserved ?? 0,
  };
}

/** 物理仓：native 有量优先；否则按销售占比从 OVERSEAS 分摊（与规划页 / supply_lots 一致）。 */
export function resolvePlanningInventoryPositionFromSnapshots(params: {
  warehouseCode: string;
  nativeSnapshot?: Partial<InventoryPositionSnapshot> | null;
  overseasSnapshot?: Partial<InventoryPositionSnapshot> | null;
  share?: ShareParseResult;
  dedupeMode?: InventoryDedupeMode;
}): InventoryPositionBreakdown {
  const dedupeMode = params.dedupeMode ?? PLANNING_INVENTORY_DEDUPE_MODE;
  const native = normalizeSnapshotForWarehouse(
    toInventoryPositionSnapshot(params.nativeSnapshot),
    params.warehouseCode,
  );

  if (params.warehouseCode === IN_PRODUCTION_WAREHOUSE) {
    return mergeInventoryPosition({
      dedupeMode,
      snapshot: native,
      draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
      sources: snapshotSources(native),
    });
  }

  const hasNativeStock = native.qtyAvailable > 0 || native.qtyInTransit > 0;
  if (hasNativeStock) {
    return mergeInventoryPosition({
      dedupeMode,
      snapshot: native,
      draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
      sources: snapshotSources(native),
    });
  }

  const overseas = toInventoryPositionSnapshot(params.overseasSnapshot);
  const share = params.share;
  if (
    share?.method === 'sales_share' &&
    (overseas.qtyAvailable > 0 || overseas.qtyInTransit > 0)
  ) {
    const qtyAvailable =
      allocateByShare(overseas.qtyAvailable, share).get(params.warehouseCode) ?? 0;
    const qtyInTransit =
      allocateByShare(overseas.qtyInTransit, share).get(params.warehouseCode) ?? 0;
    const allocated = normalizeSnapshotForWarehouse(
      {
        qtyAvailable,
        qtyInTransit,
        qtyInProduction: 0,
        qtyReserved: native.qtyReserved,
      },
      params.warehouseCode,
    );
    return mergeInventoryPosition({
      dedupeMode,
      snapshot: allocated,
      draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
      sources: snapshotSources(allocated),
    });
  }

  return mergeInventoryPosition({
    dedupeMode,
    snapshot: native,
    draftBuckets: { inProduction: 0, inTransit: 0, confirmedOpen: 0 },
    sources: snapshotSources(native),
  });
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

async function loadLatestInventoryRecordSnapshot(params: {
  skuId: string;
  warehouseCode: string;
}): Promise<InventoryPositionSnapshot | null> {
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

  if (!record) return null;
  return {
    qtyAvailable: record.qtyAvailable ?? 0,
    qtyInTransit: record.qtyInTransit ?? 0,
    qtyInProduction: record.qtyInProduction ?? 0,
    qtyReserved: record.qtyReserved ?? 0,
  };
}

export async function resolveInventoryPosition(params: {
  skuId: string;
  warehouseCode: string;
  dedupeMode?: InventoryDedupeMode;
}): Promise<InventoryPositionBreakdown> {
  const dedupeMode = params.dedupeMode ?? 'drafts_fill_gap';

  if (dedupeMode === 'snapshot_only' || params.warehouseCode === IN_PRODUCTION_WAREHOUSE) {
    const [nativeRecord, overseasRecord, skuRow] = await Promise.all([
      loadLatestInventoryRecordSnapshot({
        skuId: params.skuId,
        warehouseCode: params.warehouseCode,
      }),
      params.warehouseCode === IN_PRODUCTION_WAREHOUSE
        ? Promise.resolve(null)
        : loadLatestInventoryRecordSnapshot({
            skuId: params.skuId,
            warehouseCode: UNALLOCATED_TRANSIT_WAREHOUSE,
          }),
      params.warehouseCode === IN_PRODUCTION_WAREHOUSE
        ? Promise.resolve(null)
        : db
            .select({ encodingMeta: skus.encodingMeta })
            .from(skus)
            .where(eq(skus.id, params.skuId))
            .limit(1)
            .then((rows) => rows[0] ?? null),
    ]);

    const share = skuRow
      ? parseSharesFromSnapshot(readTurnoverSnapshot(skuRow.encodingMeta))
      : undefined;

    return resolvePlanningInventoryPositionFromSnapshots({
      warehouseCode: params.warehouseCode,
      nativeSnapshot: nativeRecord,
      overseasSnapshot: overseasRecord,
      share,
      dedupeMode,
    });
  }

  const record = await loadLatestInventoryRecordSnapshot({
    skuId: params.skuId,
    warehouseCode: params.warehouseCode,
  });

  const snapshot = normalizeSnapshotForWarehouse(
    toInventoryPositionSnapshot(record),
    params.warehouseCode,
  );

  const draftRows = await db
    .select({
      id: purchaseDrafts.id,
      status: purchaseDrafts.status,
      qty: purchaseDrafts.qty,
      receivedQty: purchaseDrafts.receivedQty,
    })
    .from(purchaseDrafts)
    .where(eq(purchaseDrafts.skuId, params.skuId));

  const draftLines: DraftOpenLine[] = draftRows.map((row) => ({
    draftId: row.id,
    status: row.status,
    openQty: openDraftQty(row.qty, row.receivedQty),
    warehouseCode: null,
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
