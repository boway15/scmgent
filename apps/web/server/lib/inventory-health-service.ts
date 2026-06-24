/**
 * 统一库存健康计算服务：库存总览、补货任务、预警任务共用同一口径。
 */
import { eq, and } from 'drizzle-orm';
import {
  db,
  skus,
  salesHistory,
  salesForecastMonthly,
  safetyStockConfig,
  warehouses,
  spus,
} from '@scm/db';
import { calcReplenishment } from './replenishment.js';
import {
  calcCoverageReplenishmentFromForecast,
  buildForecastMap,
  calcForwardAvgDaily,
  stationForWarehouse,
} from './forecast-demand.js';
import { resolveLeadTimeForSkuWarehouse } from './lead-time-resolver.js';
import { getLatestInventorySnapshot } from './inventory-snapshot.js';
import { isGrayLifecycle, type InventoryHealth } from './inventory-light.js';
import type { CoverageReplenishmentResult } from './replenishment-coverage.js';

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
};

async function loadPolicyMap(skuId: string) {
  const rows = await db
    .select()
    .from(safetyStockConfig)
    .where(eq(safetyStockConfig.skuId, skuId));
  return new Map(rows.map((row) => [row.warehouseCode, row]));
}

async function loadForecastMap(skuId: string, station: string) {
  const rows = await db
    .select({
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      lifecycle: salesForecastMonthly.lifecycle,
    })
    .from(salesForecastMonthly)
    .where(
      and(eq(salesForecastMonthly.skuId, skuId), eq(salesForecastMonthly.station, station)),
    );
  const lifecycle = rows.find((r) => r.lifecycle)?.lifecycle ?? undefined;
  const map = buildForecastMap(
    rows.map((r) => ({
      forecastYear: r.forecastYear,
      month: r.month,
      forecastDailyAvg: Number(r.forecastDailyAvg),
    })),
  );
  return { map, lifecycle };
}

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
  policyMap: Map<string, (typeof safetyStockConfig.$inferSelect) | undefined>;
  forecastByStation: Map<string, { map: Map<string, number>; lifecycle?: string }>;
  moq?: number;
}): Promise<SkuHealthRow> {
  const whSales = params.salesRows
    .filter((s) => s.warehouseCode === params.warehouse.code)
    .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) }));

  const leadTime = await resolveLeadTimeForSkuWarehouse({
    skuId: params.sku.id,
    merchantCode: params.sku.merchantCode,
    warehouseCode: params.warehouse.code,
    skuLeadTimeDays: params.sku.leadTimeDays,
  });

  const eoqCalc = calcReplenishment({
    sales: whSales,
    leadTimeDays: leadTime.totalLeadDays,
    unitCost: params.sku.unitCost ? Number(params.sku.unitCost) : 1,
  });

  const policy = params.policyMap.get(params.warehouse.code) ?? params.policyMap.get('ALL');
  const snapshot = await getLatestInventorySnapshot(params.sku.id, params.warehouse.code);
  const station = stationForWarehouse(params.warehouse.regionGroup, params.warehouse.countryCode);

  if (!params.forecastByStation.has(station)) {
    params.forecastByStation.set(station, await loadForecastMap(params.sku.id, station));
  }
  const forecastEntry = params.forecastByStation.get(station)!;

  const coverage = calcCoverageReplenishmentFromForecast({
    effectiveQty: snapshot.effectiveQty,
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
    effectiveQty: snapshot.effectiveQty,
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
      productionDays: coverage.leadTime.productionDays,
      shippingDays: coverage.leadTime.shippingDays,
      inboundBufferDays: coverage.leadTime.inboundBufferDays,
      safetyStockDays: coverage.safetyStockDays,
      targetCoverageDays: coverage.targetCoverageDays,
      overstockThresholdDays: coverage.overstockThresholdDays,
      reorderPoint: eoqCalc.reorderPoint,
      safetyStockQty: eoqCalc.safetyStockQty,
    },
    coverage,
  };
}

export async function computeAllInventoryHealth(): Promise<SkuHealthRow[]> {
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

  const rows: SkuHealthRow[] = [];

  for (const sku of activeSkus) {
    const effectiveMoq =
      sku.moq && sku.moq > 0
        ? sku.moq
        : sku.spuId
          ? (spuMoqMap.get(sku.spuId) ?? 0)
          : 0;

    const policyMap = await loadPolicyMap(sku.id);
    const forecastByStation = new Map<
      string,
      { map: Map<string, number>; lifecycle?: string }
    >();

    const salesRows = await db
      .select({
        qtySold: salesHistory.qtySold,
        saleDate: salesHistory.saleDate,
        warehouseCode: salesHistory.warehouseCode,
      })
      .from(salesHistory)
      .where(eq(salesHistory.skuId, sku.id));

    for (const wh of whRows) {
      const health = await computeSkuWarehouseHealth({
        sku,
        warehouse: wh,
        salesRows,
        policyMap,
        forecastByStation,
        moq: effectiveMoq || undefined,
      });
      rows.push(health);
    }
  }

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
