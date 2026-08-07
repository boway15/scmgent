/**
 * 统一库存健康计算服务：补货任务、预警任务、SKU 规划共用 snapshot_only 口径（与库存总览分仓同源）。
 */
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  db,
  inventoryRecords,
  skus,
  safetyStockConfig,
  warehouses,
  spus,
  leadTimeProfiles,
  merchants,
  skuSuppliers,
} from '@scm/db';
import { calcReorderPoint, calcReplenishment } from './replenishment.js';
import {
  calcCoverageReplenishmentFromForecast,
  calcForwardAvgDaily,
} from './forecast-demand.js';
import {
  resolveLeadTimeForSkuWarehouse,
  resolveLeadTimeFromCaches,
  type LeadTimeProfileRow,
  type LeadTimeResolveCaches,
  type ResolvedLeadTime,
} from './lead-time-resolver.js';
import {
  buildInventoryPositionMetrics,
  PLANNING_INVENTORY_DEDUPE_MODE,
  resolveInventoryPosition,
  resolveInventoryPositionFromSnapshot,
  type InventoryPositionBreakdown,
} from './inventory-position.js';
import { isGrayLifecycle, type InventoryHealth } from './inventory-light.js';
import {
  buildLeadTimeMetrics,
  type CoverageReplenishmentResult,
} from './replenishment-coverage.js';
import { loadDailySalesBySkuIds } from './sales-history-query.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
import { calcEffectiveDailyDemand } from './effective-daily-demand.js';
import { replenishmentSalesLookbackDays } from './sales-history-config.js';

export const MIN_AVAILABILITY_COVERAGE = 0.3;

const SKU_IN_CHUNK = 2000;

type HistoricalInventoryRow = {
  recordedDate: string | Date;
  qtyAvailable: number;
  createdAt: Date;
};

type PolicyRow = typeof safetyStockConfig.$inferSelect;

function dateKey(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function positionKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
}

export function resolveHistoricalDemand(params: {
  sales: Array<{ qtySold: number; saleDate: string }>;
  inventoryRows: HistoricalInventoryRow[];
  windowDays: number;
  asOf?: Date;
}) {
  const latestByDate = new Map<string, HistoricalInventoryRow>();
  for (const row of params.inventoryRows) {
    const key = dateKey(row.recordedDate);
    const current = latestByDate.get(key);
    if (!current || row.createdAt.getTime() > current.createdAt.getTime()) {
      latestByDate.set(key, row);
    }
  }

  const hasReliableCoverage =
    latestByDate.size / params.windowDays >= MIN_AVAILABILITY_COVERAGE;
  const result = calcEffectiveDailyDemand({
    sales: params.sales,
    availability: hasReliableCoverage
      ? Array.from(latestByDate, ([date, row]) => ({ date, qtyAvailable: row.qtyAvailable }))
      : [],
    windowDays: params.windowDays,
    asOf: params.asOf,
  });

  return {
    avgDaily: result.avgDaily,
    stockoutAdjusted: result.stockoutAdjusted,
    inStockDays: result.inStockDays,
    demandWindowDays: result.windowDays,
  };
}

async function loadDailyAvailability(params: {
  skuId: string;
  warehouseCode: string;
  windowDays: number;
  asOf?: Date;
}): Promise<HistoricalInventoryRow[]> {
  const asOf = params.asOf ?? new Date();
  const windowStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  windowStart.setUTCDate(windowStart.getUTCDate() - params.windowDays);

  return db
    .select({
      recordedDate: inventoryRecords.recordedDate,
      qtyAvailable: inventoryRecords.qtyAvailable,
      createdAt: inventoryRecords.createdAt,
    })
    .from(inventoryRecords)
    .where(
      and(
        eq(inventoryRecords.skuId, params.skuId),
        eq(inventoryRecords.warehouse, params.warehouseCode),
        gte(inventoryRecords.recordedDate, dateKey(windowStart)),
        lt(inventoryRecords.recordedDate, dateKey(asOf)),
      ),
    )
    .orderBy(asc(inventoryRecords.recordedDate), asc(inventoryRecords.createdAt));
}

async function loadPolicyMapsBySkuIds(
  skuIds: string[],
): Promise<Map<string, Map<string, PolicyRow>>> {
  const result = new Map<string, Map<string, PolicyRow>>();
  if (!skuIds.length) return result;

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const rows = await db
      .select()
      .from(safetyStockConfig)
      .where(inArray(safetyStockConfig.skuId, chunk));
    for (const row of rows) {
      let map = result.get(row.skuId);
      if (!map) {
        map = new Map();
        result.set(row.skuId, map);
      }
      map.set(row.warehouseCode, row);
    }
  }
  return result;
}

type LatestInvRow = {
  skuId: string;
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
};

async function loadLatestInventorySnapshotsBySkuIds(
  skuIds: string[],
): Promise<Map<string, InventoryPositionBreakdown>> {
  const result = new Map<string, InventoryPositionBreakdown>();
  if (!skuIds.length) return result;

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const queryResult = await db.execute(sql`
      WITH latest_inv AS (
        SELECT DISTINCT ON (sku_id, warehouse)
          sku_id,
          warehouse,
          qty_available,
          qty_in_transit,
          qty_in_production,
          qty_reserved
        FROM inventory_records
        WHERE sku_id IN (${sql.join(
          chunk.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        ORDER BY sku_id, warehouse, recorded_date DESC, created_at DESC
      )
      SELECT
        sku_id AS "skuId",
        warehouse AS "warehouseCode",
        qty_available::int AS "qtyAvailable",
        qty_in_transit::int AS "qtyInTransit",
        qty_in_production::int AS "qtyInProduction",
        COALESCE(qty_reserved, 0)::int AS "qtyReserved"
      FROM latest_inv
    `);

    for (const row of Array.from(queryResult as unknown as LatestInvRow[])) {
      result.set(
        positionKey(row.skuId, row.warehouseCode),
        resolveInventoryPositionFromSnapshot({
          warehouseCode: row.warehouseCode,
          qtyAvailable: row.qtyAvailable,
          qtyInTransit: row.qtyInTransit,
          qtyInProduction: row.qtyInProduction,
          qtyReserved: row.qtyReserved,
          dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
        }),
      );
    }
  }
  return result;
}

async function loadLeadTimeCaches(skuIds: string[]): Promise<LeadTimeResolveCaches> {
  const profileRows = await db
    .select({
      id: leadTimeProfiles.id,
      merchantCode: leadTimeProfiles.merchantCode,
      destinationWarehouseCode: leadTimeProfiles.destinationWarehouseCode,
      transportMode: leadTimeProfiles.transportMode,
      productionDays: leadTimeProfiles.productionDays,
      domesticDays: leadTimeProfiles.domesticDays,
      bookingDays: leadTimeProfiles.bookingDays,
      transitDays: leadTimeProfiles.transitDays,
      customsDays: leadTimeProfiles.customsDays,
      inboundDays: leadTimeProfiles.inboundDays,
    })
    .from(leadTimeProfiles)
    .where(eq(leadTimeProfiles.isDefault, true));

  const profilesByWarehouse = new Map<string, LeadTimeProfileRow[]>();
  for (const row of profileRows) {
    const list = profilesByWarehouse.get(row.destinationWarehouseCode) ?? [];
    list.push(row);
    profilesByWarehouse.set(row.destinationWarehouseCode, list);
  }

  const merchantRows = await db
    .select({ code: merchants.code, productionLeadDays: merchants.productionLeadDays })
    .from(merchants);
  const merchantProductionDays = new Map(
    merchantRows.map((m) => [m.code, m.productionLeadDays] as const),
  );

  const skuDefaultSupplierLeadDays = new Map<string, number | null | undefined>();
  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const supplierRows = await db
      .select({
        skuId: skuSuppliers.skuId,
        leadTimeDays: skuSuppliers.leadTimeDays,
      })
      .from(skuSuppliers)
      .where(and(inArray(skuSuppliers.skuId, chunk), eq(skuSuppliers.isDefault, true)));
    for (const row of supplierRows) {
      skuDefaultSupplierLeadDays.set(row.skuId, row.leadTimeDays);
    }
  }

  const warehouseRows = await db
    .select({
      code: warehouses.code,
      shippingLeadDays: warehouses.shippingLeadDays,
      inboundBufferDays: warehouses.inboundBufferDays,
    })
    .from(warehouses);
  const warehouseShipping = new Map(
    warehouseRows.map(
      (w) =>
        [
          w.code,
          {
            shippingLeadDays: w.shippingLeadDays,
            inboundBufferDays: w.inboundBufferDays,
          },
        ] as const,
    ),
  );

  return {
    profilesByWarehouse,
    merchantProductionDays,
    skuDefaultSupplierLeadDays,
    warehouseShipping,
  };
}

async function loadHistoricalAvailabilityBySkuIds(params: {
  skuIds: string[];
  windowDays: number;
  asOf?: Date;
}): Promise<Map<string, HistoricalInventoryRow[]>> {
  const result = new Map<string, HistoricalInventoryRow[]>();
  if (!params.skuIds.length) return result;

  const asOf = params.asOf ?? new Date();
  const windowStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  windowStart.setUTCDate(windowStart.getUTCDate() - params.windowDays);
  const startKey = dateKey(windowStart);
  const endKey = dateKey(asOf);

  for (let offset = 0; offset < params.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = params.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const rows = await db
      .select({
        skuId: inventoryRecords.skuId,
        warehouseCode: inventoryRecords.warehouse,
        recordedDate: inventoryRecords.recordedDate,
        qtyAvailable: inventoryRecords.qtyAvailable,
        createdAt: inventoryRecords.createdAt,
      })
      .from(inventoryRecords)
      .where(
        and(
          inArray(inventoryRecords.skuId, chunk),
          gte(inventoryRecords.recordedDate, startKey),
          lt(inventoryRecords.recordedDate, endKey),
        ),
      )
      .orderBy(
        asc(inventoryRecords.skuId),
        asc(inventoryRecords.warehouse),
        asc(inventoryRecords.recordedDate),
        asc(inventoryRecords.createdAt),
      );

    for (const row of rows) {
      const key = positionKey(row.skuId, row.warehouseCode);
      const list = result.get(key) ?? [];
      list.push({
        recordedDate: row.recordedDate,
        qtyAvailable: row.qtyAvailable,
        createdAt: row.createdAt,
      });
      result.set(key, list);
    }
  }
  return result;
}

export type SkuHealthRow = {
  skuId: string;
  skuCode: string;
  spuId: string | null;
  merchantCode: string | null;
  warehouseCode: string;
  regionGroup: string;
  countryCode: string | null;
  effectiveQty: number;
  avgDaily: number;
  demandSource: 'forecast' | 'historical';
  healthStatus: InventoryHealth;
  coverageDays: number;
  totalLeadDays: number;
  latestOrderDays: number;
  lifecycle?: string;
  needsReplenishment: boolean;
  suggestedQty: number;
  suggestedDate: string;
  metrics: Record<string, unknown>;
  coverage: CoverageReplenishmentResult & { demandSource: 'forecast' | 'historical' };
  position: InventoryPositionBreakdown;
  leadTime: ResolvedLeadTime;
};

export async function computeSkuWarehouseHealth(params: {
  sku: {
    id: string;
    code: string;
    spuId: string | null;
    merchantCode: string | null;
    leadTimeDays: number | null;
    unitCost: string | null;
  };
  warehouse: { code: string; regionGroup: string; countryCode: string | null };
  salesRows: Array<{ qtySold: number; saleDate: string; warehouseCode: string | null }>;
  policyMap: Map<string, PolicyRow | undefined>;
  forecastByStation: Map<string, { map: Map<string, number>; lifecycle?: string }>;
  forecastEntry?: { map: Map<string, number>; lifecycle?: string };
  moq?: number;
  /** 全量预加载缓存：传入后跳过 lead / position / availability 的按条查库 */
  caches?: {
    leadTime: ResolvedLeadTime;
    position: InventoryPositionBreakdown;
    /** 无预测时使用；缺省则回退单条 loadDailyAvailability */
    availabilityRows?: HistoricalInventoryRow[];
  };
}): Promise<SkuHealthRow> {
  const whSales = params.salesRows
    .filter((s) => s.warehouseCode === params.warehouse.code)
    .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) }));

  const leadTime =
    params.caches?.leadTime ??
    (await resolveLeadTimeForSkuWarehouse({
      skuId: params.sku.id,
      merchantCode: params.sku.merchantCode,
      warehouseCode: params.warehouse.code,
      skuLeadTimeDays: params.sku.leadTimeDays,
    }));

  let eoqCalc = calcReplenishment({
    sales: whSales,
    leadTimeDays: leadTime.totalLeadDays,
    unitCost: params.sku.unitCost ? Number(params.sku.unitCost) : 1,
  });

  const policy = params.policyMap.get(params.warehouse.code) ?? params.policyMap.get('ALL');
  const position =
    params.caches?.position ??
    (await resolveInventoryPosition({
      skuId: params.sku.id,
      warehouseCode: params.warehouse.code,
      dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
    }));

  if (!params.forecastEntry) {
    if (!params.forecastByStation.has(FORECAST_GLOBAL_STATION)) {
      const merged = await loadMergedPublishedForecastBySkuIds([params.sku.id]);
      const resolved = merged.get(params.sku.id) ?? {
        map: new Map<string, number>(),
        lifecycle: undefined,
        versionId: null,
      };
      params.forecastByStation.set(FORECAST_GLOBAL_STATION, {
        map: resolved.map,
        lifecycle: resolved.lifecycle,
      });
    }
  }
  const forecastEntry =
    params.forecastEntry ??
    params.forecastByStation.get(FORECAST_GLOBAL_STATION) ?? { map: new Map(), lifecycle: undefined };

  const demandWindowDays = replenishmentSalesLookbackDays();
  let historicalDemand = {
    avgDaily: eoqCalc.avgDaily,
    stockoutAdjusted: false,
    inStockDays: 0,
    demandWindowDays,
  };
  if (!forecastEntry.map.size) {
    const inventoryRows =
      params.caches && 'availabilityRows' in params.caches
        ? (params.caches.availabilityRows ?? [])
        : await loadDailyAvailability({
            skuId: params.sku.id,
            warehouseCode: params.warehouse.code,
            windowDays: demandWindowDays,
          });
    historicalDemand = resolveHistoricalDemand({
      sales: whSales,
      inventoryRows,
      windowDays: demandWindowDays,
    });
    eoqCalc = {
      ...eoqCalc,
      avgDaily: historicalDemand.avgDaily,
      reorderPoint: calcReorderPoint(
        historicalDemand.avgDaily,
        leadTime.totalLeadDays,
        eoqCalc.safetyStockQty,
      ),
    };
  }

  const coverage = calcCoverageReplenishmentFromForecast({
    effectiveQty: position.effectiveQty,
    forecasts: forecastEntry.map,
    historicalAvgDaily: eoqCalc.avgDaily,
    productionDays: leadTime.productionDays,
    shippingDays: leadTime.shippingDays,
    inboundBufferDays: leadTime.inboundBufferDays,
    safetyStockDays: policy?.safetyStockDays ?? undefined,
    targetCoverageDays: policy?.targetCoverageDays ?? undefined,
    overstockThresholdDays: policy?.overstockThresholdDays ?? undefined,
    moq: params.moq,
    lifecycle: forecastEntry.lifecycle,
  });

  const avgDaily =
    coverage.demandSource === 'forecast'
      ? calcForwardAvgDaily(forecastEntry.map, new Date(), 90, eoqCalc.avgDaily)
      : eoqCalc.avgDaily;

  return {
    skuId: params.sku.id,
    skuCode: params.sku.code,
    spuId: params.sku.spuId,
    merchantCode: params.sku.merchantCode,
    warehouseCode: params.warehouse.code,
    regionGroup: params.warehouse.regionGroup,
    countryCode: params.warehouse.countryCode,
    effectiveQty: position.effectiveQty,
    avgDaily,
    demandSource: coverage.demandSource,
    healthStatus: coverage.healthStatus,
    coverageDays: coverage.coverageDays,
    totalLeadDays: coverage.leadTime.totalLeadDays,
    latestOrderDays: coverage.latestOrderDays,
    lifecycle: forecastEntry.lifecycle,
    needsReplenishment: coverage.needsReplenishment,
    suggestedQty: coverage.suggestedQty,
    suggestedDate: coverage.suggestedDate,
    metrics: {
      planningCalculatedAt: new Date().toISOString(),
      ...buildLeadTimeMetrics(leadTime),
      safetyStockDays: coverage.safetyStockDays,
      targetCoverageDays: coverage.targetCoverageDays,
      overstockThresholdDays: coverage.overstockThresholdDays,
      reorderPoint: eoqCalc.reorderPoint,
      safetyStockQty: eoqCalc.safetyStockQty,
      stockoutAdjusted: historicalDemand.stockoutAdjusted,
      inStockDays: historicalDemand.inStockDays,
      demandWindowDays: historicalDemand.demandWindowDays,
      ...buildInventoryPositionMetrics(position),
    },
    coverage,
    position,
    leadTime,
  };
}

export async function computeAllInventoryHealth(): Promise<SkuHealthRow[]> {
  const t0 = Date.now();

  const spuMoqMap = new Map(
    (await db.select({ id: spus.id, moq: spus.moq }).from(spus)).map((s) => [s.id, s.moq]),
  );

  const activeSkus = await db
    .select({
      id: skus.id,
      code: skus.code,
      spuId: skus.spuId,
      moq: skus.moq,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const whRows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);

  const skuIds = activeSkus.map((sku) => sku.id);
  console.info(
    `[inventory-health] start skus=${activeSkus.length} warehouses=${whRows.length} pairs=${activeSkus.length * whRows.length}`,
  );

  const tSales = Date.now();
  const [salesBySkuId, forecastBySkuId] = await Promise.all([
    loadDailySalesBySkuIds(skuIds),
    loadMergedPublishedForecastBySkuIds(skuIds),
  ]);
  console.info(`[inventory-health] sales+forecast ${Date.now() - tSales}ms`);

  const tPreload = Date.now();
  const [policyBySku, positionByKey, leadTimeCaches] = await Promise.all([
    loadPolicyMapsBySkuIds(skuIds),
    loadLatestInventorySnapshotsBySkuIds(skuIds),
    loadLeadTimeCaches(skuIds),
  ]);

  const demandWindowDays = replenishmentSalesLookbackDays();
  const noForecastSkuIds = skuIds.filter((id) => {
    const entry = forecastBySkuId.get(id);
    return !entry?.map.size;
  });
  const availabilityByKey = await loadHistoricalAvailabilityBySkuIds({
    skuIds: noForecastSkuIds,
    windowDays: demandWindowDays,
  });
  console.info(
    `[inventory-health] preload ${Date.now() - tPreload}ms policies=${policyBySku.size} positions=${positionByKey.size} noForecastSkus=${noForecastSkuIds.length} availabilityKeys=${availabilityByKey.size}`,
  );

  const emptyPosition = (warehouseCode: string) =>
    resolveInventoryPositionFromSnapshot({
      warehouseCode,
      dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
    });

  const rows: SkuHealthRow[] = [];
  const tCompute = Date.now();

  for (const sku of activeSkus) {
    const effectiveMoq =
      sku.moq && sku.moq > 0
        ? sku.moq
        : sku.spuId
          ? (spuMoqMap.get(sku.spuId) ?? 0)
          : 0;

    const policyMap = policyBySku.get(sku.id) ?? new Map();
    const forecastEntry = forecastBySkuId.get(sku.id) ?? {
      map: new Map<string, number>(),
      lifecycle: undefined,
      versionId: null,
    };
    const forecastByStation = new Map<string, { map: Map<string, number>; lifecycle?: string }>();
    const salesRows = salesBySkuId.get(sku.id) ?? [];
    const hasForecast = forecastEntry.map.size > 0;

    for (const wh of whRows) {
      const key = positionKey(sku.id, wh.code);
      const leadTime = resolveLeadTimeFromCaches(
        {
          skuId: sku.id,
          merchantCode: sku.merchantCode,
          warehouseCode: wh.code,
          skuLeadTimeDays: sku.leadTimeDays,
        },
        leadTimeCaches,
      );
      const health = await computeSkuWarehouseHealth({
        sku,
        warehouse: wh,
        salesRows,
        policyMap,
        forecastByStation,
        forecastEntry,
        moq: effectiveMoq || undefined,
        caches: {
          leadTime,
          position: positionByKey.get(key) ?? emptyPosition(wh.code),
          ...(hasForecast
            ? {}
            : { availabilityRows: availabilityByKey.get(key) ?? [] }),
        },
      });
      rows.push(health);
    }
  }

  console.info(
    `[inventory-health] compute ${Date.now() - tCompute}ms rows=${rows.length} total=${Date.now() - t0}ms`,
  );
  return rows;
}

export function healthToAlertType(
  health: InventoryHealth,
  effectiveQty: number,
): 'stockout' | 'below_safety' | 'below_rop' | null {
  if (effectiveQty <= 0) return 'stockout';
  if (health === 'red') return 'below_rop';
  if (health === 'yellow') return 'below_safety';
  return null;
}

export function healthToExceptionType(
  health: InventoryHealth,
  lifecycle?: string | null,
): 'stockout' | 'overstock' | 'slow_moving' | 'lifecycle_eol' | null {
  if (health === 'blue') return 'overstock';
  if (health === 'gray') {
    return isGrayLifecycle(lifecycle) ? 'lifecycle_eol' : 'slow_moving';
  }
  return null;
}

export function recommendedActionForException(
  type: 'stockout' | 'overstock' | 'slow_moving' | 'lifecycle_eol',
): string {
  switch (type) {
    case 'overstock':
      return '评估停补、调拨或促销清仓';
    case 'slow_moving':
      return '评估降价清仓或停止采购';
    case 'lifecycle_eol':
      return '确认停售计划并清理剩余库存';
    case 'stockout':
      return '紧急补货或调拨';
    default:
      return '人工确认处理方案';
  }
}
