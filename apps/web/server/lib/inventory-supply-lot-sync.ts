import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import {
  db,
  inventoryRecords,
  inventorySupplyLots,
  pmcPlanItems,
  pmcPlans,
  purchaseDrafts,
  shipments,
  skus,
  warehouses,
} from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import {
  buildLotsFromInputs,
  type BuiltSupplyLot,
} from './inventory-supply-lots.js';
import { openDraftQty } from './inventory-position.js';
import {
  DEFAULT_INBOUND_BUFFER_DAYS,
  DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE,
} from './replenishment-coverage.js';
import { resolveLeadTimeForSkuWarehouse } from './lead-time-resolver.js';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadLatestPhysicalSnapshots(): Promise<
  Array<{
    skuId: string;
    warehouseCode: string;
    qtyAvailable: number;
    qtyInTransit: number;
    qtyReserved: number;
    recordedDate: string;
  }>
> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (sku_id, warehouse)
      sku_id AS "skuId",
      warehouse AS "warehouseCode",
      qty_available::int AS "qtyAvailable",
      COALESCE(qty_in_transit, 0)::int AS "qtyInTransit",
      COALESCE(qty_reserved, 0)::int AS "qtyReserved",
      recorded_date::text AS "recordedDate"
    FROM ${inventoryRecords}
    WHERE warehouse <> ${IN_PRODUCTION_WAREHOUSE}
    ORDER BY sku_id, warehouse, recorded_date DESC, created_at DESC
  `);
  return Array.from(rows as unknown as Array<{
    skuId: string;
    warehouseCode: string;
    qtyAvailable: number;
    qtyInTransit: number;
    qtyReserved: number;
    recordedDate: string;
  }>);
}

/**
 * 全量重建 open 批次（保留 manual 行）。
 * 飞书拉取后应调用；未知日期批次仍落库但不进时间轴。
 */
export async function syncInventorySupplyLots(params?: {
  today?: string;
}): Promise<{ lotCount: number; eligibleCount: number }> {
  const today = params?.today ?? todayIso();
  const snapshots = await loadLatestPhysicalSnapshots();

  const openDrafts = await db
    .select({
      draftId: purchaseDrafts.id,
      skuId: purchaseDrafts.skuId,
      status: purchaseDrafts.status,
      qty: purchaseDrafts.qty,
      receivedQty: purchaseDrafts.receivedQty,
      warehouseCode: pmcPlans.targetWarehouseCode,
      shipReadyAt: purchaseDrafts.plannedPickupDate,
      plannedProductionDoneDate: purchaseDrafts.plannedProductionDoneDate,
      etaAvailable: purchaseDrafts.etaAvailable,
      merchantCode: skus.merchantCode,
      skuLeadTimeDays: skus.leadTimeDays,
    })
    .from(purchaseDrafts)
    .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
    .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
    .innerJoin(skus, eq(purchaseDrafts.skuId, skus.id))
    .where(notInArray(purchaseDrafts.status, ['received', 'cancelled']));

  const shipmentRows = await db
    .select({
      shipmentId: shipments.id,
      skuId: shipments.skuId,
      qty: shipments.qty,
      etaAvailable: shipments.etaAvailable,
      status: shipments.status,
      draftId: shipments.draftId,
    })
    .from(shipments)
    .where(notInArray(shipments.status, ['available', 'cancelled']));

  const draftWarehouseById = new Map(
    openDrafts.map((d) => [d.draftId, d.warehouseCode ?? null]),
  );

  const remainingBySkuWh = new Map<string, number>();
  async function remainingLogistics(skuId: string, warehouseCode: string, merchantCode?: string | null, skuLead?: number | null) {
    const key = `${skuId}::${warehouseCode}`;
    if (remainingBySkuWh.has(key)) return remainingBySkuWh.get(key)!;
    const lead = await resolveLeadTimeForSkuWarehouse({
      skuId,
      warehouseCode,
      merchantCode,
      skuLeadTimeDays: skuLead,
    });
    const days =
      lead.bookingDays + lead.transitDays + lead.customsDays + lead.inboundDays;
    remainingBySkuWh.set(key, days);
    return days;
  }

  const draftInputs = [];
  for (const d of openDrafts) {
    const openQty = openDraftQty(d.qty, d.receivedQty);
    if (openQty <= 0) continue;
    const wh = d.warehouseCode;
    if (!wh) continue;
    const remaining = await remainingLogistics(
      d.skuId,
      wh,
      d.merchantCode,
      d.skuLeadTimeDays,
    );
    draftInputs.push({
      draftId: d.draftId,
      skuId: d.skuId,
      warehouseCode: wh,
      status: d.status,
      openQty,
      shipReadyAt: d.shipReadyAt,
      plannedProductionDoneDate: d.plannedProductionDoneDate,
      etaAvailable: d.etaAvailable,
      remainingLogisticsDays: remaining,
    });
  }

  const shipmentInputs = shipmentRows.map((s) => ({
    shipmentId: s.shipmentId,
    skuId: s.skuId,
    warehouseCode: s.draftId ? draftWarehouseById.get(s.draftId) ?? null : null,
    qty: s.qty,
    etaAvailable: s.etaAvailable,
    status: s.status,
  })).filter((s) => s.warehouseCode);

  // 无跟单仓的发运：尝试从 pmc 关联补仓；否则跳过（避免错误摊到仓）
  const defaultTransit: Record<string, number> = { ...DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE };
  const whRows = await db
    .select({
      code: warehouses.code,
      shippingLeadDays: warehouses.shippingLeadDays,
      inboundBufferDays: warehouses.inboundBufferDays,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true));
  for (const wh of whRows) {
    const ship = wh.shippingLeadDays ?? DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE[wh.code] ?? 60;
    const inbound = wh.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS;
    defaultTransit[wh.code] = ship + inbound;
  }

  const { lots, eligibleLots } = buildLotsFromInputs({
    snapshots: snapshots.map((s) => ({
      skuId: s.skuId,
      warehouseCode: s.warehouseCode,
      qtyAvailable: s.qtyAvailable,
      qtyInTransit: s.qtyInTransit,
      qtyReserved: s.qtyReserved,
      recordedDate: s.recordedDate,
    })),
    drafts: draftInputs,
    shipments: shipmentInputs,
    today,
    defaultTransitLeadDaysByWarehouse: defaultTransit,
  });

  await persistBuiltLots(lots);
  return { lotCount: lots.length, eligibleCount: eligibleLots.length };
}

async function persistBuiltLots(lots: BuiltSupplyLot[]) {
  // 取消非 manual 的旧 open 批次，再 upsert 新批次
  await db
    .update(inventorySupplyLots)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(inventorySupplyLots.status, 'open'),
        notInArray(inventorySupplyLots.source, ['manual']),
      ),
    );

  if (!lots.length) return;

  const now = new Date();
  const values = lots.map((lot) => ({
    skuId: lot.skuId,
    warehouseCode: lot.warehouseCode,
    pool: lot.pool,
    qty: lot.qty,
    factoryCode: lot.factoryCode ?? null,
    productionStatus: lot.productionStatus ?? null,
    shipReadyAt: lot.shipReadyAt ?? null,
    latestShipDate: lot.latestShipDate ?? null,
    availableAt: lot.availableAt,
    source: lot.source,
    sourceId: lot.sourceId,
    status: 'open' as const,
    etaEstimated: lot.etaEstimated ?? false,
    dateUnknown: lot.dateUnknown ?? lot.availableAt == null,
    updatedAt: now,
  }));

  const chunkSize = 500;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await db
      .insert(inventorySupplyLots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          inventorySupplyLots.source,
          inventorySupplyLots.sourceId,
          inventorySupplyLots.pool,
          inventorySupplyLots.warehouseCode,
        ],
        set: {
          qty: sql`excluded.qty`,
          factoryCode: sql`excluded.factory_code`,
          productionStatus: sql`excluded.production_status`,
          shipReadyAt: sql`excluded.ship_ready_at`,
          latestShipDate: sql`excluded.latest_ship_date`,
          availableAt: sql`excluded.available_at`,
          status: sql`'open'`,
          etaEstimated: sql`excluded.eta_estimated`,
          dateUnknown: sql`excluded.date_unknown`,
          updatedAt: now,
        },
      });
  }
}

export async function listSupplyLots(params: {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouseCode?: string;
  skuId?: string;
  includeCancelled?: boolean;
  limit?: number;
}) {
  const limit = params.limit ?? 500;
  const conditions = [];
  if (!params.includeCancelled) {
    conditions.push(eq(inventorySupplyLots.status, 'open'));
  }
  if (params.pool) conditions.push(eq(inventorySupplyLots.pool, params.pool));
  if (params.warehouseCode) {
    conditions.push(eq(inventorySupplyLots.warehouseCode, params.warehouseCode));
  }
  if (params.skuId) conditions.push(eq(inventorySupplyLots.skuId, params.skuId));

  return db
    .select({
      id: inventorySupplyLots.id,
      skuId: inventorySupplyLots.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: inventorySupplyLots.warehouseCode,
      pool: inventorySupplyLots.pool,
      qty: inventorySupplyLots.qty,
      factoryCode: inventorySupplyLots.factoryCode,
      productionStatus: inventorySupplyLots.productionStatus,
      shipReadyAt: inventorySupplyLots.shipReadyAt,
      latestShipDate: inventorySupplyLots.latestShipDate,
      availableAt: inventorySupplyLots.availableAt,
      source: inventorySupplyLots.source,
      sourceId: inventorySupplyLots.sourceId,
      status: inventorySupplyLots.status,
      etaEstimated: inventorySupplyLots.etaEstimated,
      dateUnknown: inventorySupplyLots.dateUnknown,
      updatedAt: inventorySupplyLots.updatedAt,
    })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inventorySupplyLots.updatedAt))
    .limit(limit);
}

export async function updateLocalLotDates(params: {
  lotId: string;
  productionStatus?: 'in_production' | 'qc_pending' | 'completed';
  shipReadyAt?: string | null;
  latestShipDate?: string | null;
  remainingLogisticsDays?: number;
}) {
  const [existing] = await db
    .select()
    .from(inventorySupplyLots)
    .where(eq(inventorySupplyLots.id, params.lotId))
    .limit(1);
  if (!existing) return null;
  if (existing.pool !== 'local') {
    throw new Error('Only local lots support ship-ready date maintenance');
  }

  const shipReadyAt =
    params.shipReadyAt !== undefined ? params.shipReadyAt : existing.shipReadyAt;
  const productionStatus =
    params.productionStatus ?? existing.productionStatus ?? 'completed';

  let availableAt = existing.availableAt;
  if (shipReadyAt && params.remainingLogisticsDays != null) {
    const d = new Date(`${shipReadyAt}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + Math.max(0, params.remainingLogisticsDays));
    availableAt = d.toISOString().slice(0, 10);
  } else if (shipReadyAt && existing.availableAt && existing.shipReadyAt) {
    // 保持原 lead 差
    const oldReady = new Date(`${existing.shipReadyAt}T00:00:00.000Z`).getTime();
    const oldAvail = new Date(`${existing.availableAt}T00:00:00.000Z`).getTime();
    const leadDays = Math.round((oldAvail - oldReady) / 86400000);
    if (Number.isFinite(leadDays) && leadDays >= 0) {
      const d = new Date(`${shipReadyAt}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + leadDays);
      availableAt = d.toISOString().slice(0, 10);
    }
  }

  const [updated] = await db
    .update(inventorySupplyLots)
    .set({
      productionStatus,
      shipReadyAt,
      latestShipDate:
        params.latestShipDate !== undefined
          ? params.latestShipDate
          : existing.latestShipDate,
      availableAt,
      dateUnknown: availableAt == null,
      source: existing.source === 'snapshot' ? 'manual' : existing.source,
      updatedAt: new Date(),
    })
    .where(eq(inventorySupplyLots.id, params.lotId))
    .returning();

  return updated ?? null;
}

export async function loadOpenLotsForTimeline(params: {
  skuId: string;
  warehouseCode: string;
  today?: string;
}): Promise<
  Array<{
    pool: 'overseas' | 'in_transit' | 'local';
    qty: number;
    availableAt: string | null;
    productionStatus: 'in_production' | 'qc_pending' | 'completed' | null;
    shipReadyAt: string | null;
    etaEstimated: boolean;
    dateUnknown: boolean;
  }>
> {
  const rows = await db
    .select()
    .from(inventorySupplyLots)
    .where(
      and(
        eq(inventorySupplyLots.skuId, params.skuId),
        eq(inventorySupplyLots.warehouseCode, params.warehouseCode),
        eq(inventorySupplyLots.status, 'open'),
      ),
    );

  return rows.map((row) => ({
    pool: row.pool as 'overseas' | 'in_transit' | 'local',
    qty: row.qty,
    availableAt: row.availableAt,
    productionStatus: (row.productionStatus ?? null) as
      | 'in_production'
      | 'qc_pending'
      | 'completed'
      | null,
    shipReadyAt: row.shipReadyAt,
    etaEstimated: row.etaEstimated,
    dateUnknown: row.dateUnknown,
  }));
}
