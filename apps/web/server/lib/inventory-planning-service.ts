import { and, eq } from 'drizzle-orm';
import {
  db,
  pmcPlanItems,
  pmcPlans,
  purchaseDrafts,
  safetyStockConfig,
  skus,
  spus,
  warehouses,
} from '@scm/db';
import {
  computeSkuWarehouseHealth,
  type SkuHealthRow,
} from './inventory-health-service.js';
import type { InventoryPositionBreakdown } from './inventory-position.js';
import type { ResolvedLeadTime } from './lead-time-resolver.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { loadDailySalesBySkuIds } from './sales-history-query.js';

export type SkuPlanningView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  position: InventoryPositionBreakdown;
  leadTime: ResolvedLeadTime;
  avgDaily: number;
  demandSource: 'forecast' | 'historical';
  coverageDays: number;
  safetyStockDays: number;
  reorderPoint?: number;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: string;
  etaAvailableNearest?: string | null;
  stockoutDateEstimate?: string | null;
};

type PlanningHealth = Pick<
  SkuHealthRow,
  | 'skuId'
  | 'skuCode'
  | 'warehouseCode'
  | 'avgDaily'
  | 'demandSource'
  | 'coverageDays'
  | 'suggestedQty'
  | 'suggestedDate'
  | 'healthStatus'
  | 'metrics'
  | 'position'
  | 'leadTime'
> & {
  coverage: Pick<SkuHealthRow['coverage'], 'safetyStockDays'>;
};

const OPEN_ETA_STATUSES = new Set([
  'draft',
  'confirmed',
  'in_production',
  'ready_to_ship',
  'in_transit',
  'partial_received',
  'exception',
]);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function estimateStockoutDate(
  avgDaily: number,
  coverageDays: number,
  today = new Date(),
): string | null {
  if (avgDaily <= 0 || !Number.isFinite(coverageDays) || coverageDays < 0) return null;
  const result = new Date(today);
  result.setUTCDate(result.getUTCDate() + Math.floor(coverageDays));
  return isoDate(result);
}

export function pickNearestEtaAvailable(
  rows: Array<{
    etaAvailable: string | null;
    warehouseCode: string | null;
    status: string;
  }>,
  warehouseCode: string,
  today = isoDate(new Date()),
): string | null {
  const candidates = rows
    .filter(
      (row) =>
        row.warehouseCode === warehouseCode &&
        row.etaAvailable != null &&
        row.etaAvailable >= today &&
        OPEN_ETA_STATUSES.has(row.status),
    )
    .map((row) => row.etaAvailable as string)
    .sort((a, b) => a.localeCompare(b));
  return candidates[0] ?? null;
}

export function buildSkuPlanningView(input: {
  health: PlanningHealth;
  etaAvailableNearest?: string | null;
  today?: Date;
}): SkuPlanningView {
  const reorderPoint = Number(input.health.metrics.reorderPoint);
  return {
    skuId: input.health.skuId,
    skuCode: input.health.skuCode,
    warehouseCode: input.health.warehouseCode,
    position: input.health.position,
    leadTime: input.health.leadTime,
    avgDaily: input.health.avgDaily,
    demandSource: input.health.demandSource,
    coverageDays: input.health.coverageDays,
    safetyStockDays: input.health.coverage.safetyStockDays,
    ...(Number.isFinite(reorderPoint) ? { reorderPoint } : {}),
    suggestedQty: input.health.suggestedQty,
    suggestedDate: input.health.suggestedDate,
    healthStatus: input.health.healthStatus,
    etaAvailableNearest: input.etaAvailableNearest ?? null,
    stockoutDateEstimate: estimateStockoutDate(
      input.health.avgDaily,
      input.health.coverageDays,
      input.today,
    ),
  };
}

export async function getSkuPlanningView(params: {
  skuId: string;
  warehouseCode?: string;
}): Promise<SkuPlanningView | null> {
  const [sku] = await db
    .select({
      id: skus.id,
      code: skus.code,
      spuId: skus.spuId,
      skuMoq: skus.moq,
      spuMoq: spus.moq,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
    })
    .from(skus)
    .leftJoin(spus, eq(skus.spuId, spus.id))
    .where(eq(skus.id, params.skuId))
    .limit(1);
  if (!sku) return null;

  const warehouseCondition = params.warehouseCode
    ? and(eq(warehouses.isActive, true), eq(warehouses.code, params.warehouseCode))
    : eq(warehouses.isActive, true);
  const [warehouse] = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(warehouseCondition)
    .orderBy(warehouses.sortOrder)
    .limit(1);
  if (!warehouse) return null;

  const [policies, salesBySkuId, forecastBySkuId, etaRows] = await Promise.all([
    db.select().from(safetyStockConfig).where(eq(safetyStockConfig.skuId, sku.id)),
    loadDailySalesBySkuIds([sku.id]),
    loadMergedPublishedForecastBySkuIds([sku.id]),
    db
      .select({
        etaAvailable: purchaseDrafts.etaAvailable,
        status: purchaseDrafts.status,
        itemWarehouseCode: pmcPlanItems.warehouseCode,
        planWarehouseCode: pmcPlans.targetWarehouseCode,
      })
      .from(purchaseDrafts)
      .leftJoin(pmcPlanItems, eq(purchaseDrafts.planItemId, pmcPlanItems.id))
      .leftJoin(pmcPlans, eq(pmcPlanItems.planId, pmcPlans.id))
      .where(eq(purchaseDrafts.skuId, sku.id)),
  ]);

  const forecastEntry = forecastBySkuId.get(sku.id) ?? {
    map: new Map<string, number>(),
    lifecycle: undefined,
    versionId: null,
  };
  const health = await computeSkuWarehouseHealth({
    sku: {
      id: sku.id,
      code: sku.code,
      spuId: sku.spuId,
      merchantCode: sku.merchantCode,
      leadTimeDays: sku.leadTimeDays,
      unitCost: sku.unitCost,
    },
    warehouse,
    salesRows: salesBySkuId.get(sku.id) ?? [],
    policyMap: new Map(policies.map((policy) => [policy.warehouseCode, policy])),
    forecastByStation: new Map(),
    forecastEntry,
    moq: sku.skuMoq || sku.spuMoq || undefined,
  });
  const etaAvailableNearest = pickNearestEtaAvailable(
    etaRows.map((row) => ({
      etaAvailable: row.etaAvailable,
      status: row.status,
      warehouseCode: row.itemWarehouseCode ?? row.planWarehouseCode,
    })),
    warehouse.code,
  );

  return buildSkuPlanningView({ health, etaAvailableNearest });
}
