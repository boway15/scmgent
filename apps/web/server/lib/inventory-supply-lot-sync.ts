import { and, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import {
  db,
  inventoryRecords,
  inventorySupplyLots,
  procurementListRows,
  skus,
  warehouses,
} from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE, POOL_DISPLAY_LABEL } from './inventory-constants.js';
import {
  parseSharesFromSnapshot,
  parseTransitBuckets,
} from './inventory-share-allocation.js';
import {
  buildLotsFromInputs,
  isLotEligibleForTimeline,
  type BuiltSupplyLot,
  type SkuAllocationContext,
} from './inventory-supply-lots.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import { buildCsv } from './csv-export.js';
import { parseProductScope, productScopeSql, type ProductScope } from './planning-accessory-filter.js';
import {
  buildDestWarehouseByRequestNo,
  createWarehouseLabelResolver,
  extractSkuCodeFromMirrorRow,
  feishuFollowUpRowsToDraftInputs,
} from './procurement-feishu-supply.js';
import {
  DEFAULT_INBOUND_BUFFER_DAYS,
  DEFAULT_SHIPPING_LEAD_BY_WAREHOUSE,
} from './replenishment-coverage.js';

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
      AND source = 'import'
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

async function loadLatestInProduction(): Promise<Array<{ skuId: string; qty: number }>> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (sku_id)
      sku_id AS "skuId",
      COALESCE(qty_in_production, 0)::int AS "qty"
    FROM ${inventoryRecords}
    WHERE warehouse = ${IN_PRODUCTION_WAREHOUSE}
      AND COALESCE(qty_in_production, 0) > 0
      AND source = 'import'
    ORDER BY sku_id, recorded_date DESC, created_at DESC
  `);
  return Array.from(rows as unknown as Array<{ skuId: string; qty: number }>);
}

export function buildAllocationBySku(
  rows: Array<{ skuId: string; encodingMeta: unknown }>,
): Map<string, SkuAllocationContext> {
  const allocationBySku = new Map<string, SkuAllocationContext>();
  for (const row of rows) {
    const snapshot = readTurnoverSnapshot(row.encodingMeta);
    const earliest = snapshot['最早在途上架时间']?.trim() || null;
    allocationBySku.set(row.skuId, {
      share: parseSharesFromSnapshot(snapshot),
      transitBuckets: parseTransitBuckets(snapshot),
      earliestAvailableAt: earliest,
      earliestPoAvailableAt: snapshot['采购单最早上架时间']?.trim() || null,
    });
  }
  return allocationBySku;
}

async function loadAllocationBySkuIds(
  skuIds: string[],
): Promise<Map<string, SkuAllocationContext>> {
  if (skuIds.length === 0) return new Map();
  const rows = await db
    .select({
      skuId: skus.id,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(inArray(skus.id, skuIds));
  return buildAllocationBySku(rows);
}

/**
 * 出货前不定目的仓：跟单无 warehouse 时不叠加海运段，仅算可出货日。
 * @deprecated 保留导出供旧测试迁移；同步逻辑直接使用 remainingLogisticsDays=0。
 */
export function resolveDraftLeadWarehouse(
  draftWarehouseCode: string | null | undefined,
  _skuId: string,
  _allocationBySku: Map<string, SkuAllocationContext>,
): string | null {
  return draftWarehouseCode ?? null;
}

async function loadFeishuMirrorDraftInputs(): Promise<
  ReturnType<typeof feishuFollowUpRowsToDraftInputs>
> {
  const [bulkRows, followUpRows, whRows] = await Promise.all([
    db
      .select({ rowData: procurementListRows.rowData })
      .from(procurementListRows)
      .where(eq(procurementListRows.listType, 'bulk_stock_request')),
    db
      .select({
        rowIndex: procurementListRows.rowIndex,
        bitableRecordId: procurementListRows.bitableRecordId,
        rowData: procurementListRows.rowData,
      })
      .from(procurementListRows)
      .where(eq(procurementListRows.listType, 'purchase_follow_up')),
    db
      .select({ code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, true)),
  ]);

  const warehouseNames: Record<string, string> = {};
  for (const wh of whRows) {
    if (wh.name) warehouseNames[wh.code] = wh.name;
  }
  const resolveWarehouse = createWarehouseLabelResolver({
    warehouseCodes: whRows.map((wh) => wh.code),
    warehouseNames,
  });
  const destByRequestNo = buildDestWarehouseByRequestNo(bulkRows, resolveWarehouse);

  const skuCodes = new Set<string>();
  for (const row of followUpRows) {
    const code = extractSkuCodeFromMirrorRow(row.rowData ?? {});
    if (code) skuCodes.add(code);
  }
  if (skuCodes.size === 0) return [];

  const skuRows = await db
    .select({ id: skus.id, code: skus.code })
    .from(skus)
    .where(inArray(skus.code, [...skuCodes]));

  const skuCodeToId = new Map(skuRows.map((row) => [row.code, row.id]));

  return feishuFollowUpRowsToDraftInputs({
    rows: followUpRows.map((row) => ({
      rowIndex: row.rowIndex,
      bitableRecordId: row.bitableRecordId,
      rowData: row.rowData ?? {},
    })),
    skuCodeToId,
    destByRequestNo,
    resolveWarehouse,
  });
}

/**
 * 全量重建 open 批次（保留 manual 行）。
 * 在途/在产单据来自飞书采购镜像；不再读取本系统 purchase_drafts / shipments。
 */
export async function syncInventorySupplyLots(params?: {
  today?: string;
}): Promise<{ lotCount: number; eligibleCount: number }> {
  const today = params?.today ?? todayIso();
  const snapshots = await loadLatestPhysicalSnapshots();
  const inProduction = await loadLatestInProduction();
  const draftInputs = await loadFeishuMirrorDraftInputs();

  const allocationBySku = await loadAllocationBySkuIds([
    ...new Set([
      ...snapshots.map((row) => row.skuId),
      ...inProduction.map((row) => row.skuId),
      ...draftInputs.map((row) => row.skuId),
    ]),
  ]);

  const shipmentInputs: Array<{
    shipmentId: string;
    skuId: string;
    warehouseCode: string | null;
    qty: number;
    etaAvailable: string | null;
    status: string;
  }> = [];
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

  const { lots } = buildLotsFromInputs({
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
    allocationBySku,
    inProduction,
  });

  const eligibleLots = lots.filter((lot) =>
    isLotEligibleForTimeline({
      pool: lot.pool,
      availableAt: lot.availableAt,
      productionStatus: lot.productionStatus,
      shipReadyAt: lot.shipReadyAt,
      today,
    }),
  );

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

function buildSupplyLotConditions(params: {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouseCode?: string;
  skuId?: string;
  includeCancelled?: boolean;
  q?: string;
  dateUnknown?: boolean;
  productScope?: ProductScope;
}) {
  const conditions = [productScopeSql(params.productScope ?? 'goods')];
  if (!params.includeCancelled) {
    conditions.push(eq(inventorySupplyLots.status, 'open'));
  }
  if (params.pool) conditions.push(eq(inventorySupplyLots.pool, params.pool));
  if (params.warehouseCode) {
    conditions.push(eq(inventorySupplyLots.warehouseCode, params.warehouseCode));
  }
  if (params.skuId) conditions.push(eq(inventorySupplyLots.skuId, params.skuId));
  if (params.dateUnknown) {
    conditions.push(
      sql`(${inventorySupplyLots.dateUnknown} = true OR ${inventorySupplyLots.availableAt} IS NULL)`,
    );
  }
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(inventorySupplyLots.warehouseCode, pattern),
        ilike(inventorySupplyLots.factoryCode, pattern),
      )!,
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

export async function countSupplyLots(params: {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouseCode?: string;
  skuId?: string;
  includeCancelled?: boolean;
  q?: string;
  dateUnknown?: boolean;
  productScope?: ProductScope;
}) {
  const where = buildSupplyLotConditions(params);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where);
  return Number(row?.count ?? 0);
}

export async function listSupplyLots(params: {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouseCode?: string;
  skuId?: string;
  includeCancelled?: boolean;
  limit?: number;
  offset?: number;
  q?: string;
  dateUnknown?: boolean;
  productScope?: ProductScope;
}) {
  const limit = params.limit ?? 500;
  const offset = params.offset ?? 0;
  const where = buildSupplyLotConditions(params);

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
    .where(where)
    .orderBy(desc(inventorySupplyLots.updatedAt))
    .limit(limit)
    .offset(offset);
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

export type OpenTimelineLot = {
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  availableAt: string | null;
  productionStatus: 'in_production' | 'qc_pending' | 'completed' | null;
  shipReadyAt: string | null;
  etaEstimated: boolean;
  dateUnknown: boolean;
};

function isoDateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapOpenTimelineLot(row: {
  pool: string;
  qty: number;
  availableAt: unknown;
  productionStatus: string | null;
  shipReadyAt: unknown;
  etaEstimated: boolean;
  dateUnknown: boolean;
}): OpenTimelineLot {
  return {
    pool: row.pool as 'overseas' | 'in_transit' | 'local',
    qty: row.qty,
    availableAt: isoDateOnly(row.availableAt),
    productionStatus: (row.productionStatus ?? null) as
      | 'in_production'
      | 'qc_pending'
      | 'completed'
      | null,
    shipReadyAt: isoDateOnly(row.shipReadyAt),
    etaEstimated: row.etaEstimated,
    dateUnknown: row.dateUnknown,
  };
}

const OPEN_LOT_SKU_CHUNK = 2000;

/** 缺货预警等全量扫描：按 SKU 分批拉 open lots，键为 skuId::warehouseCode。 */
export async function loadOpenLotsBySkuWarehouse(
  skuIds: string[],
): Promise<Map<string, OpenTimelineLot[]>> {
  const grouped = new Map<string, OpenTimelineLot[]>();
  if (!skuIds.length) return grouped;

  for (let offset = 0; offset < skuIds.length; offset += OPEN_LOT_SKU_CHUNK) {
    const chunk = skuIds.slice(offset, offset + OPEN_LOT_SKU_CHUNK);
    const rows = await db
      .select({
        skuId: inventorySupplyLots.skuId,
        warehouseCode: inventorySupplyLots.warehouseCode,
        pool: inventorySupplyLots.pool,
        qty: inventorySupplyLots.qty,
        availableAt: inventorySupplyLots.availableAt,
        productionStatus: inventorySupplyLots.productionStatus,
        shipReadyAt: inventorySupplyLots.shipReadyAt,
        etaEstimated: inventorySupplyLots.etaEstimated,
        dateUnknown: inventorySupplyLots.dateUnknown,
      })
      .from(inventorySupplyLots)
      .where(
        and(inArray(inventorySupplyLots.skuId, chunk), eq(inventorySupplyLots.status, 'open')),
      );

    for (const row of rows) {
      const key = `${row.skuId}::${row.warehouseCode}`;
      const list = grouped.get(key) ?? [];
      list.push(mapOpenTimelineLot(row));
      grouped.set(key, list);
    }
  }

  return grouped;
}

async function loadOpenLotsForSku(params: {
  skuId: string;
  warehouseCode?: string;
}): Promise<OpenTimelineLot[]> {
  const conditions = [
    eq(inventorySupplyLots.skuId, params.skuId),
    eq(inventorySupplyLots.status, 'open'),
  ];
  if (params.warehouseCode) {
    conditions.push(eq(inventorySupplyLots.warehouseCode, params.warehouseCode));
  }

  const rows = await db
    .select()
    .from(inventorySupplyLots)
    .where(and(...conditions));

  return rows.map(mapOpenTimelineLot);
}

export async function loadOpenLotsForTimeline(params: {
  skuId: string;
  warehouseCode: string;
  today?: string;
}): Promise<OpenTimelineLot[]> {
  return loadOpenLotsForSku({
    skuId: params.skuId,
    warehouseCode: params.warehouseCode,
  });
}

/** 全网络 open lots（含 IN-PRODUCTION、OVERSEAS 与各物理目的仓），供 SKU 级网络时间轴聚合供给。 */
export async function loadOpenLotsForNetworkTimeline(params: {
  skuId: string;
}): Promise<OpenTimelineLot[]> {
  return loadOpenLotsForSku({ skuId: params.skuId });
}

const POOL_LABEL = POOL_DISPLAY_LABEL;

const BATCH_EXPORT_HEADERS = [
  'SKU',
  'SKU名称',
  '目的仓',
  '池',
  '数量',
  '生产状态',
  '可出货日',
  '预计可售日',
  '是否估期',
  '日期未知',
  '来源',
  '来源ID',
] as const;

export type SupplyLotExportFilters = {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouseCode?: string;
  q?: string;
  dateUnknown?: boolean;
  productScope?: ProductScope;
};

export function parseSupplyLotExportFilters(
  query: Record<string, string | undefined>,
): SupplyLotExportFilters {
  const pool = query.pool as 'overseas' | 'in_transit' | 'local' | undefined;
  return {
    pool: pool || undefined,
    warehouseCode: query.warehouse?.trim() || undefined,
    q: query.q?.trim() || undefined,
    dateUnknown: query.dateUnknown === 'true' ? true : undefined,
    productScope: parseProductScope(query.productScope),
  };
}

function supplyLotRowToCsvRow(row: Awaited<ReturnType<typeof listSupplyLots>>[number]) {
  return [
    row.skuCode,
    row.skuName,
    row.warehouseCode,
    POOL_LABEL[row.pool as keyof typeof POOL_LABEL] ?? row.pool,
    row.qty,
    row.productionStatus ?? '',
    row.shipReadyAt ?? '',
    row.availableAt ?? '',
    row.etaEstimated ? '是' : '否',
    row.dateUnknown ? '是' : '否',
    row.source,
    row.sourceId ?? '',
  ];
}

export async function buildSupplyLotsExportCsv(filters: SupplyLotExportFilters) {
  const rows = await listSupplyLots({ ...filters, limit: 50000, offset: 0 });
  return buildCsv([...BATCH_EXPORT_HEADERS], rows.map(supplyLotRowToCsvRow));
}
