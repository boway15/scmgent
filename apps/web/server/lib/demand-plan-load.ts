import { and, eq } from 'drizzle-orm';
import {
  db,
  demandPlanVersions,
  demandPlanWeekly,
  planningDemandAdoptions,
  skus,
} from '@scm/db';
import { parseDemandPlanPilotConfig } from './demand-plan-config.js';
import {
  excludedCrossGroupSpuIds,
  type SkuPilotInput,
} from './demand-plan-eligibility.js';
import { warehouseShareWeight } from './demand-plan-reconstruct.js';
import {
  resolvePlanningDemandFromInputs,
  type PlanningDemandResult,
} from './demand-plan-resolve.js';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';

export type LoadPlanningDemandSku = {
  projectGroup: string | null;
  spuId: string | null;
  isActive: boolean;
  encodingMeta?: unknown;
};

export type LoadPublishedDemandRow = {
  period: string;
  systemDailyAvg: number | string;
  manualDailyAvg: number | string | null;
};

export type LoadPlanningDemandAdoption = {
  source: 'forecast' | 'demand_plan';
  demandPlanVersionId: string | null;
};

export type LoadPlanningDemandDeps = {
  env?: NodeJS.ProcessEnv;
  loadSku?: (skuId: string) => Promise<LoadPlanningDemandSku | undefined>;
  loadSiblingSkus?: (spuId: string) => Promise<SkuPilotInput[]>;
  loadAdoption?: (input: {
    projectGroup: string;
    warehouseCode: string;
  }) => Promise<LoadPlanningDemandAdoption | undefined>;
  loadPublishedDemandRows?: (input: {
    skuId: string;
    warehouseCode: string;
    projectGroup: string;
  }) => Promise<LoadPublishedDemandRow[]>;
};

export function buildChampionWarehouseRows(
  stationForecastMap: Map<string, number>,
  share: number | null,
): Array<{ period: string; daily: number }> {
  if (share == null) return [];
  return [...stationForecastMap.entries()].map(([period, daily]) => ({
    period,
    daily: daily * share,
  }));
}

export function parseDemandPlanMonthlyNumbers(
  rows: LoadPublishedDemandRow[],
): Array<{ period: string; systemDailyAvg: number; manualDailyAvg: number | null }> {
  return rows.map((row) => ({
    period: row.period,
    systemDailyAvg: Number(row.systemDailyAvg),
    manualDailyAvg:
      row.manualDailyAvg == null || row.manualDailyAvg === ''
        ? null
        : Number(row.manualDailyAvg),
  }));
}

function shareFromEncodingMeta(
  warehouseCode: string,
  encodingMeta: unknown,
): number | null {
  const parsed = parseSharesFromSnapshot(readTurnoverSnapshot(encodingMeta));
  return warehouseShareWeight(warehouseCode, parsed.weights);
}

async function defaultLoadSku(skuId: string): Promise<LoadPlanningDemandSku | undefined> {
  const rows = await db
    .select({
      projectGroup: skus.projectGroup,
      spuId: skus.spuId,
      isActive: skus.isActive,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(eq(skus.id, skuId))
    .limit(1);
  return rows[0];
}

async function defaultLoadSiblingSkus(spuId: string): Promise<SkuPilotInput[]> {
  return db
    .select({
      skuId: skus.id,
      projectGroup: skus.projectGroup,
      spuId: skus.spuId,
      isActive: skus.isActive,
    })
    .from(skus)
    .where(and(eq(skus.spuId, spuId), eq(skus.isActive, true)));
}

async function defaultLoadAdoption(input: {
  projectGroup: string;
  warehouseCode: string;
}): Promise<LoadPlanningDemandAdoption | undefined> {
  const rows = await db
    .select({
      source: planningDemandAdoptions.source,
      demandPlanVersionId: planningDemandAdoptions.demandPlanVersionId,
    })
    .from(planningDemandAdoptions)
    .where(
      and(
        eq(planningDemandAdoptions.projectGroup, input.projectGroup),
        eq(planningDemandAdoptions.warehouseCode, input.warehouseCode),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    source: row.source === 'demand_plan' ? 'demand_plan' : 'forecast',
    demandPlanVersionId: row.demandPlanVersionId,
  };
}

async function defaultLoadPublishedDemandRows(input: {
  skuId: string;
  warehouseCode: string;
  projectGroup: string;
}): Promise<LoadPublishedDemandRow[]> {
  return db
    .select({
      period: demandPlanWeekly.period,
      systemDailyAvg: demandPlanWeekly.systemDailyAvg,
      manualDailyAvg: demandPlanWeekly.manualDailyAvg,
    })
    .from(demandPlanWeekly)
    .innerJoin(demandPlanVersions, eq(demandPlanWeekly.versionId, demandPlanVersions.id))
    .innerJoin(
      planningDemandAdoptions,
      and(
        eq(planningDemandAdoptions.demandPlanVersionId, demandPlanWeekly.versionId),
        eq(planningDemandAdoptions.projectGroup, input.projectGroup),
        eq(planningDemandAdoptions.warehouseCode, input.warehouseCode),
        eq(planningDemandAdoptions.source, 'demand_plan'),
      ),
    )
    .where(
      and(
        eq(demandPlanVersions.status, 'pilot_published'),
        eq(demandPlanWeekly.skuId, input.skuId),
        eq(demandPlanWeekly.warehouseCode, input.warehouseCode),
      ),
    );
}

export async function loadPlanningDemandForSkuWarehouse(
  input: {
    skuId: string;
    warehouseCode: string;
    championForecastMap: Map<string, number>;
  },
  deps: LoadPlanningDemandDeps = {},
): Promise<PlanningDemandResult> {
  const config = parseDemandPlanPilotConfig(deps.env ?? process.env);
  const loadSku = deps.loadSku ?? defaultLoadSku;
  const loadSiblingSkus = deps.loadSiblingSkus ?? defaultLoadSiblingSkus;
  const loadAdoption = deps.loadAdoption ?? defaultLoadAdoption;
  const loadPublishedDemandRows =
    deps.loadPublishedDemandRows ?? defaultLoadPublishedDemandRows;

  const skuRow = await loadSku(input.skuId);
  if (!skuRow) {
    return resolvePlanningDemandFromInputs({
      pilotEnabled: false,
      adoptionSource: 'forecast',
      excludedSpu: false,
      hasShare: false,
      demandRows: [],
      championWarehouseRows: [],
      stationForecastMap: input.championForecastMap,
    });
  }

  const sku: SkuPilotInput = {
    skuId: input.skuId,
    projectGroup: skuRow.projectGroup,
    spuId: skuRow.spuId,
    isActive: skuRow.isActive,
  };
  const share = shareFromEncodingMeta(input.warehouseCode, skuRow.encodingMeta);
  const hasShare = share != null;
  const championWarehouseRows = buildChampionWarehouseRows(
    input.championForecastMap,
    share,
  );

  if (!config.enabled) {
    return resolvePlanningDemandFromInputs({
      pilotEnabled: false,
      adoptionSource: 'forecast',
      excludedSpu: false,
      hasShare,
      demandRows: [],
      championWarehouseRows,
      stationForecastMap: input.championForecastMap,
    });
  }

  const siblingSkus =
    sku.spuId != null ? await loadSiblingSkus(sku.spuId) : [sku];
  const excludedSpuIds = excludedCrossGroupSpuIds(siblingSkus);
  const excludedSpu = Boolean(sku.spuId && excludedSpuIds.has(sku.spuId));

  const adoption = sku.projectGroup
    ? await loadAdoption({
        projectGroup: sku.projectGroup,
        warehouseCode: input.warehouseCode,
      })
    : undefined;
  const adoptionSource = adoption?.source === 'demand_plan' ? 'demand_plan' : 'forecast';

  let demandRows: Array<{
    period: string;
    systemDailyAvg: number;
    manualDailyAvg: number | null;
  }> = [];
  if (adoptionSource === 'demand_plan' && sku.projectGroup) {
    demandRows = parseDemandPlanMonthlyNumbers(
      await loadPublishedDemandRows({
        skuId: input.skuId,
        warehouseCode: input.warehouseCode,
        projectGroup: sku.projectGroup,
      }),
    );
  }

  return resolvePlanningDemandFromInputs({
    pilotEnabled: true,
    adoptionSource,
    excludedSpu,
    hasShare,
    demandRows,
    championWarehouseRows,
    stationForecastMap: input.championForecastMap,
  });
}
