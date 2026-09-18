/**
 * 三池供给批次纯函数：从快照 / 跟单 / 发运生成 inventory_supply_lots 行，
 * 并判断是否可进入时间轴供给（未知日期 / 未达出货交期 → 不计入）。
 */

import {
  allocateByShare,
  splitResidualTransit,
  type ShareParseResult,
} from './inventory-share-allocation.js';

export type SupplyLotPool = 'overseas' | 'in_transit' | 'local';
export type ProductionStatus = 'in_production' | 'qc_pending' | 'completed';
export type ShipReadiness =
  | 'not_due'
  | 'approaching'
  | 'ready'
  | 'scheduled'
  | 'shipped';
export type SupplyLotSource = 'snapshot' | 'purchase_draft' | 'shipment' | 'manual';

export type BuiltSupplyLot = {
  skuId: string;
  warehouseCode: string;
  pool: SupplyLotPool;
  qty: number;
  factoryCode?: string | null;
  productionStatus?: ProductionStatus | null;
  shipReadyAt?: string | null;
  latestShipDate?: string | null;
  availableAt: string | null;
  source: SupplyLotSource;
  sourceId: string | null;
  status: 'open' | 'consumed' | 'cancelled';
  etaEstimated?: boolean;
  shipReadiness?: ShipReadiness;
  dateUnknown?: boolean;
};

export type SupplyLotSnapshotInput = {
  skuId: string;
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyReserved: number;
  recordedDate: string;
};

export type SupplyLotDraftInput = {
  draftId: string;
  skuId: string;
  warehouseCode: string | null;
  status: string;
  openQty: number;
  shipReadyAt?: string | null;
  plannedProductionDoneDate?: string | null;
  etaAvailable?: string | null;
  remainingLogisticsDays: number;
  factoryCode?: string | null;
};

export type SupplyLotShipmentInput = {
  shipmentId: string;
  skuId: string;
  warehouseCode: string | null;
  qty: number;
  etaAvailable: string | null;
  status: string;
};

export type SkuAllocationContext = {
  share: ShareParseResult;
  transitBuckets: { d5: number; d15: number; d25: number };
  earliestAvailableAt: string | null;
};

const LOCAL_STATUSES = new Set([
  'draft',
  'confirmed',
  'exception',
  'in_production',
  'ready_to_ship',
]);
const TRANSIT_STATUSES = new Set(['in_transit', 'partial_received']);
const APPROACHING_DAYS = 7;

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function subtractDaysIso(isoDate: string, days: number): string {
  return addDaysIso(isoDate, -days);
}

export function mapDraftToLotPool(status: string): SupplyLotPool | null {
  if (LOCAL_STATUSES.has(status)) return 'local';
  if (TRANSIT_STATUSES.has(status)) return 'in_transit';
  return null;
}

export function mapDraftProductionStatus(status: string): ProductionStatus | null {
  if (status === 'ready_to_ship') return 'completed';
  if (status === 'in_production') return 'in_production';
  if (status === 'draft' || status === 'confirmed' || status === 'exception') {
    return 'in_production';
  }
  return null;
}

export function deriveShipReadiness(params: {
  shipReadyAt: string | null | undefined;
  today: string;
  scheduled?: boolean;
  shipped?: boolean;
}): ShipReadiness {
  if (params.shipped) return 'shipped';
  if (params.scheduled) return 'scheduled';
  if (!params.shipReadyAt) return 'not_due';
  if (params.shipReadyAt <= params.today) return 'ready';
  const approachingCutoff = addDaysIso(params.today, APPROACHING_DAYS);
  if (params.shipReadyAt <= approachingCutoff) return 'approaching';
  return 'not_due';
}

/**
 * 本地批次 available_at = 可出货日 + 剩余物流天数。
 * 回退：ship_ready_at → planned_production_done → eta_available（已是海外可售日）→ null
 */
export function resolveLocalAvailableAt(params: {
  shipReadyAt?: string | null;
  plannedProductionDoneDate?: string | null;
  etaAvailable?: string | null;
  remainingLogisticsDays: number;
}): string | null {
  const lead = Math.max(0, params.remainingLogisticsDays);
  if (params.shipReadyAt) return addDaysIso(params.shipReadyAt, lead);
  if (params.plannedProductionDoneDate) {
    return addDaysIso(params.plannedProductionDoneDate, lead);
  }
  if (params.etaAvailable) return params.etaAvailable;
  return null;
}

/**
 * 本地未达出货交期（shipReadyAt > today 或生产未完成）不得计入时间轴供给。
 * 任意池缺 available_at 也不计入。
 */
export function isLotEligibleForTimeline(params: {
  pool: SupplyLotPool;
  availableAt: string | null;
  productionStatus?: ProductionStatus | null;
  shipReadyAt?: string | null;
  today: string;
}): boolean {
  if (!params.availableAt) return false;
  if (params.pool !== 'local') return true;
  if (params.productionStatus === 'in_production' || params.productionStatus === 'qc_pending') {
    return false;
  }
  if (params.shipReadyAt && params.shipReadyAt > params.today) return false;
  if (!params.shipReadyAt && params.productionStatus !== 'completed') return false;
  return true;
}

export function buildLotsFromInputs(params: {
  snapshots: SupplyLotSnapshotInput[];
  drafts: SupplyLotDraftInput[];
  shipments: SupplyLotShipmentInput[];
  today: string;
  defaultTransitLeadDaysByWarehouse: Record<string, number>;
  allocationBySku?: Map<string, SkuAllocationContext>;
}): { lots: BuiltSupplyLot[]; eligibleLots: BuiltSupplyLot[] } {
  const lots: BuiltSupplyLot[] = [];
  const shipmentQtyBySkuWh = new Map<string, number>();
  const docTransitQty = new Map<string, number>();
  const overseasTransitDone = new Set<string>();

  for (const ship of params.shipments) {
    if (ship.status === 'available' || ship.status === 'cancelled') continue;
    const wh = ship.warehouseCode;
    if (!wh || ship.qty <= 0) continue;
    const key = `${ship.skuId}::${wh}`;
    shipmentQtyBySkuWh.set(key, (shipmentQtyBySkuWh.get(key) ?? 0) + ship.qty);
    docTransitQty.set(ship.skuId, (docTransitQty.get(ship.skuId) ?? 0) + ship.qty);

    const availableAt =
      ship.etaAvailable ??
      addDaysIso(
        params.today,
        params.defaultTransitLeadDaysByWarehouse[wh] ?? 60,
      );
    lots.push({
      skuId: ship.skuId,
      warehouseCode: wh,
      pool: 'in_transit',
      qty: ship.qty,
      availableAt,
      source: 'shipment',
      sourceId: ship.shipmentId,
      status: 'open',
      etaEstimated: !ship.etaAvailable,
      shipReadiness: 'shipped',
      dateUnknown: !ship.etaAvailable,
    });
  }

  for (const draft of params.drafts) {
    if (draft.openQty <= 0) continue;
    if (!TRANSIT_STATUSES.has(draft.status)) continue;
    docTransitQty.set(draft.skuId, (docTransitQty.get(draft.skuId) ?? 0) + draft.openQty);
  }

  for (const snap of params.snapshots) {
    const ctx = params.allocationBySku?.get(snap.skuId);
    const isOverseas = snap.warehouseCode === 'OVERSEAS';

    if (snap.qtyAvailable > 0) {
      if (isOverseas && ctx?.share.method === 'sales_share') {
        const allocated = allocateByShare(snap.qtyAvailable, ctx.share);
        for (const [warehouseCode, qty] of allocated) {
          lots.push({
            skuId: snap.skuId,
            warehouseCode,
            pool: 'overseas',
            qty,
            availableAt: snap.recordedDate,
            source: 'snapshot',
            sourceId: `avail-share:${snap.skuId}:${warehouseCode}`,
            status: 'open',
          });
        }
      } else {
        lots.push({
          skuId: snap.skuId,
          warehouseCode: snap.warehouseCode,
          pool: 'overseas',
          qty: snap.qtyAvailable,
          availableAt: snap.recordedDate,
          source: 'snapshot',
          sourceId: `avail:${snap.skuId}:${snap.warehouseCode}`,
          status: 'open',
        });
      }
    }

    if (isOverseas) {
      if (overseasTransitDone.has(snap.skuId)) continue;
      overseasTransitDone.add(snap.skuId);
      const residual = Math.max(0, snap.qtyInTransit - (docTransitQty.get(snap.skuId) ?? 0));
      if (residual <= 0) continue;
      const slices = splitResidualTransit({
        residual,
        buckets: ctx?.transitBuckets ?? { d5: 0, d15: 0, d25: 0 },
        earliestAvailableAt: ctx?.earliestAvailableAt ?? null,
        today: params.today,
      });
      for (const slice of slices) {
        if (slice.qty <= 0) continue;
        if (ctx?.share.method === 'sales_share') {
          const allocated = allocateByShare(slice.qty, ctx.share);
          for (const [warehouseCode, qty] of allocated) {
            lots.push({
              skuId: snap.skuId,
              warehouseCode,
              pool: 'in_transit',
              qty,
              availableAt: slice.availableAt,
              source: 'snapshot',
              sourceId: `transit-share:${snap.skuId}:${warehouseCode}:${slice.bucket}`,
              status: 'open',
              etaEstimated: true,
              shipReadiness: 'shipped',
              dateUnknown: slice.availableAt == null,
            });
          }
        } else {
          lots.push({
            skuId: snap.skuId,
            warehouseCode: 'OVERSEAS',
            pool: 'in_transit',
            qty: slice.qty,
            availableAt: slice.availableAt,
            source: 'snapshot',
            sourceId: `transit-share:${snap.skuId}:OVERSEAS:${slice.bucket}`,
            status: 'open',
            etaEstimated: true,
            shipReadiness: 'shipped',
            dateUnknown: slice.availableAt == null,
          });
        }
      }
      continue;
    }

    const key = `${snap.skuId}::${snap.warehouseCode}`;
    const coveredByShipments = shipmentQtyBySkuWh.get(key) ?? 0;
    const residualTransit = Math.max(0, snap.qtyInTransit - coveredByShipments);
    if (residualTransit > 0) {
      lots.push({
        skuId: snap.skuId,
        warehouseCode: snap.warehouseCode,
        pool: 'in_transit',
        qty: residualTransit,
        availableAt: null,
        source: 'snapshot',
        sourceId: `transit:${snap.skuId}:${snap.warehouseCode}`,
        status: 'open',
        etaEstimated: true,
        shipReadiness: 'shipped',
        dateUnknown: true,
      });
    }
  }

  for (const draft of params.drafts) {
    if (draft.openQty <= 0) continue;
    const pool = mapDraftToLotPool(draft.status);
    if (!pool) continue;

    const ctx = params.allocationBySku?.get(draft.skuId);
    const destinations: Array<{ warehouseCode: string; qty: number; sourceId: string }> = [];
    if (draft.warehouseCode) {
      destinations.push({
        warehouseCode: draft.warehouseCode,
        qty: draft.openQty,
        sourceId: draft.draftId,
      });
    } else if (ctx?.share.method === 'sales_share') {
      for (const [warehouseCode, qty] of allocateByShare(draft.openQty, ctx.share)) {
        destinations.push({
          warehouseCode,
          qty,
          sourceId: `${draft.draftId}#share`,
        });
      }
    } else {
      destinations.push({
        warehouseCode: 'OVERSEAS',
        qty: draft.openQty,
        sourceId: draft.draftId,
      });
    }

    for (const dest of destinations) {
      if (pool === 'local') {
        const productionStatus = mapDraftProductionStatus(draft.status);
        const availableAt = resolveLocalAvailableAt({
          shipReadyAt: draft.shipReadyAt,
          plannedProductionDoneDate: draft.plannedProductionDoneDate,
          etaAvailable: draft.etaAvailable,
          remainingLogisticsDays: draft.remainingLogisticsDays,
        });
        const shipReadyAt =
          draft.shipReadyAt ??
          draft.plannedProductionDoneDate ??
          (draft.etaAvailable
            ? subtractDaysIso(draft.etaAvailable, draft.remainingLogisticsDays)
            : null);
        const shipReadiness = deriveShipReadiness({
          shipReadyAt,
          today: params.today,
        });
        lots.push({
          skuId: draft.skuId,
          warehouseCode: dest.warehouseCode,
          pool: 'local',
          qty: dest.qty,
          factoryCode: draft.factoryCode ?? null,
          productionStatus,
          shipReadyAt,
          availableAt,
          source: 'purchase_draft',
          sourceId: dest.sourceId,
          status: 'open',
          shipReadiness,
          dateUnknown: availableAt == null,
        });
      } else {
        const availableAt =
          draft.etaAvailable ??
          addDaysIso(
            params.today,
            params.defaultTransitLeadDaysByWarehouse[dest.warehouseCode] ?? 60,
          );
        lots.push({
          skuId: draft.skuId,
          warehouseCode: dest.warehouseCode,
          pool: 'in_transit',
          qty: dest.qty,
          availableAt,
          source: 'purchase_draft',
          sourceId: dest.sourceId,
          status: 'open',
          etaEstimated: !draft.etaAvailable,
          shipReadiness: 'shipped',
          dateUnknown: !draft.etaAvailable,
        });
      }
    }
  }

  const eligibleLots = lots.filter((lot) =>
    isLotEligibleForTimeline({
      pool: lot.pool,
      availableAt: lot.availableAt,
      productionStatus: lot.productionStatus,
      shipReadyAt: lot.shipReadyAt,
      today: params.today,
    }),
  );

  return { lots, eligibleLots };
}
