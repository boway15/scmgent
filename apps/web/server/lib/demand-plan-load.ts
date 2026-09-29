import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  demandPlanVersions,
  demandPlanWeekly,
  planningDemandAdoptions,
  skus,
} from '@scm/db';
import {
  DEMAND_PLAN_PROJECT_GROUP_ALL,
  DEMAND_PLAN_WAREHOUSE_ALL,
  isProjectGroupInPilot,
  isWarehouseInPilot,
  parseDemandPlanPilotConfig,
} from './demand-plan-config.js';
import {
  excludedCrossGroupSpuIds,
  type SkuPilotInput,
} from './demand-plan-eligibility.js';
import {
  resolvePlanningDemandFromInputs,
  type PlanningDemandResult,
} from './demand-plan-resolve.js';
import {
  parseSharesFromSnapshot,
  resolveWarehouseDemandShare,
} from './inventory-share-allocation.js';
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

export function scaleDemandRowsByShare(
  rows: Array<{ period: string; systemDailyAvg: number; manualDailyAvg: number | null }>,
  share: number,
): Array<{ period: string; systemDailyAvg: number; manualDailyAvg: number | null }> {
  return rows.map((row) => ({
    period: row.period,
    systemDailyAvg: row.systemDailyAvg * share,
    manualDailyAvg: row.manualDailyAvg == null ? null : row.manualDailyAvg * share,
  }));
}

function shareFromEncodingMeta(
  warehouseCode: string,
  encodingMeta: unknown,
): number | null {
  const parsed = parseSharesFromSnapshot(readTurnoverSnapshot(encodingMeta));
  return resolveWarehouseDemandShare(warehouseCode, parsed);
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

export function buildAdoptionLookupKeys(input: {
  projectGroup: string | null;
  warehouseCode: string;
}): Array<{ projectGroup: string; warehouseCode: string }> {
  const keys: Array<{ projectGroup: string; warehouseCode: string }> = [];
  const warehouseCodes =
    input.warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL
      ? [DEMAND_PLAN_WAREHOUSE_ALL]
      : [DEMAND_PLAN_WAREHOUSE_ALL, input.warehouseCode];

  for (const warehouseCode of warehouseCodes) {
    if (input.projectGroup) {
      keys.push({ projectGroup: input.projectGroup, warehouseCode });
    }
  }
  for (const warehouseCode of warehouseCodes) {
    keys.push({ projectGroup: DEMAND_PLAN_PROJECT_GROUP_ALL, warehouseCode });
  }
  return keys;
}

async function resolvePlanningAdoption(input: {
  projectGroup: string | null;
  warehouseCode: string;
  loadAdoption: NonNullable<LoadPlanningDemandDeps['loadAdoption']>;
}): Promise<
  | {
      adoption: LoadPlanningDemandAdoption;
      adoptionProjectGroup: string;
      adoptionWarehouse: string;
    }
  | undefined
> {
  for (const key of buildAdoptionLookupKeys(input)) {
    const row = await input.loadAdoption(key);
    if (row) {
      return {
        adoption: row,
        adoptionProjectGroup: key.projectGroup,
        adoptionWarehouse: key.warehouseCode,
      };
    }
  }
  return undefined;
}

export function planningDemandDepsFromMemory(input: {
  skus: Array<LoadPlanningDemandSku & { skuId: string }>;
  adoptions?: Array<
    LoadPlanningDemandAdoption & { projectGroup: string; warehouseCode: string }
  >;
  demandRows?: Array<
    LoadPublishedDemandRow & { skuId: string; warehouseCode: string; projectGroup: string }
  >;
}): LoadPlanningDemandDeps {
  const skuById = new Map(input.skus.map((sku) => [sku.skuId, sku]));
  const siblingsBySpu = new Map<string, SkuPilotInput[]>();
  for (const sku of input.skus) {
    if (!sku.spuId || !sku.isActive) continue;
    const list = siblingsBySpu.get(sku.spuId) ?? [];
    list.push({
      skuId: sku.skuId,
      projectGroup: sku.projectGroup,
      spuId: sku.spuId,
      isActive: sku.isActive,
    });
    siblingsBySpu.set(sku.spuId, list);
  }

  const adoptionByKey = new Map(
    (input.adoptions ?? []).map((row) => [
      `${row.projectGroup}::${row.warehouseCode}`,
      {
        source: row.source,
        demandPlanVersionId: row.demandPlanVersionId,
      } satisfies LoadPlanningDemandAdoption,
    ]),
  );
  const demandByKey = new Map<string, LoadPublishedDemandRow[]>();
  for (const row of input.demandRows ?? []) {
    const key = `${row.skuId}::${row.warehouseCode}::${row.projectGroup}`;
    const list = demandByKey.get(key) ?? [];
    list.push({
      period: row.period,
      systemDailyAvg: row.systemDailyAvg,
      manualDailyAvg: row.manualDailyAvg,
    });
    demandByKey.set(key, list);
  }

  return {
    loadSku: async (skuId) => {
      const row = skuById.get(skuId);
      if (!row) return undefined;
      return {
        projectGroup: row.projectGroup,
        spuId: row.spuId,
        isActive: row.isActive,
        encodingMeta: row.encodingMeta,
      };
    },
    loadSiblingSkus: async (spuId) => siblingsBySpu.get(spuId) ?? [],
    loadAdoption: async (key) =>
      adoptionByKey.get(`${key.projectGroup}::${key.warehouseCode}`),
    loadPublishedDemandRows: async (query) =>
      demandByKey.get(`${query.skuId}::${query.warehouseCode}::${query.projectGroup}`) ?? [],
  };
}

const PLANNING_SKU_CHUNK = 2000;

/** 全量预警：一次装入 SKU / 采纳 / 已发布需求，避免每个 SKU×仓再查库。 */
export async function loadPlanningDemandDepsForSkus(skuIds: string[]): Promise<{
  deps: LoadPlanningDemandDeps;
  encodingMetaBySku: Map<string, unknown>;
}> {
  const encodingMetaBySku = new Map<string, unknown>();
  if (!skuIds.length) {
    return { deps: planningDemandDepsFromMemory({ skus: [] }), encodingMetaBySku };
  }

  const skuRows: Array<LoadPlanningDemandSku & { skuId: string }> = [];
  for (let offset = 0; offset < skuIds.length; offset += PLANNING_SKU_CHUNK) {
    const chunk = skuIds.slice(offset, offset + PLANNING_SKU_CHUNK);
    const rows = await db
      .select({
        skuId: skus.id,
        projectGroup: skus.projectGroup,
        spuId: skus.spuId,
        isActive: skus.isActive,
        encodingMeta: skus.encodingMeta,
      })
      .from(skus)
      .where(inArray(skus.id, chunk));
    for (const row of rows) {
      skuRows.push(row);
      encodingMetaBySku.set(row.skuId, row.encodingMeta);
    }
  }

  const config = parseDemandPlanPilotConfig(process.env);
  if (!config.enabled) {
    return { deps: planningDemandDepsFromMemory({ skus: skuRows }), encodingMetaBySku };
  }

  const adoptionRows = await db
    .select({
      projectGroup: planningDemandAdoptions.projectGroup,
      warehouseCode: planningDemandAdoptions.warehouseCode,
      source: planningDemandAdoptions.source,
      demandPlanVersionId: planningDemandAdoptions.demandPlanVersionId,
    })
    .from(planningDemandAdoptions);

  const demandRows: Array<
    LoadPublishedDemandRow & { skuId: string; warehouseCode: string; projectGroup: string }
  > = [];
  for (let offset = 0; offset < skuIds.length; offset += PLANNING_SKU_CHUNK) {
    const chunk = skuIds.slice(offset, offset + PLANNING_SKU_CHUNK);
    const rows = await db
      .select({
        skuId: demandPlanWeekly.skuId,
        warehouseCode: demandPlanWeekly.warehouseCode,
        period: demandPlanWeekly.period,
        systemDailyAvg: demandPlanWeekly.systemDailyAvg,
        manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        projectGroup: planningDemandAdoptions.projectGroup,
      })
      .from(demandPlanWeekly)
      .innerJoin(demandPlanVersions, eq(demandPlanWeekly.versionId, demandPlanVersions.id))
      .innerJoin(
        planningDemandAdoptions,
        and(
          eq(planningDemandAdoptions.demandPlanVersionId, demandPlanWeekly.versionId),
          eq(planningDemandAdoptions.warehouseCode, demandPlanWeekly.warehouseCode),
          eq(planningDemandAdoptions.source, 'demand_plan'),
        ),
      )
      .where(
        and(inArray(demandPlanWeekly.skuId, chunk), eq(demandPlanVersions.status, 'pilot_published')),
      );
    demandRows.push(...rows);
  }

  return {
    deps: planningDemandDepsFromMemory({
      skus: skuRows,
      adoptions: adoptionRows.map((row) => ({
        projectGroup: row.projectGroup,
        warehouseCode: row.warehouseCode,
        source: row.source === 'demand_plan' ? 'demand_plan' : 'forecast',
        demandPlanVersionId: row.demandPlanVersionId,
      })),
      demandRows,
    }),
    encodingMetaBySku,
  };
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
  const networkScope = input.warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL;

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
      networkScope,
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
      networkScope,
    });
  }

  const globalAdoption = await loadAdoption({
    projectGroup: DEMAND_PLAN_PROJECT_GROUP_ALL,
    warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
  });
  const pilotEnabled =
    globalAdoption?.source === 'demand_plan' ||
    (isProjectGroupInPilot(skuRow.projectGroup, config) &&
      isWarehouseInPilot(input.warehouseCode, config));

  if (!pilotEnabled) {
    return resolvePlanningDemandFromInputs({
      pilotEnabled: false,
      adoptionSource: 'forecast',
      excludedSpu: false,
      hasShare,
      demandRows: [],
      championWarehouseRows,
      stationForecastMap: input.championForecastMap,
      networkScope,
    });
  }

  const siblingSkus =
    sku.spuId != null ? await loadSiblingSkus(sku.spuId) : [sku];
  const excludedSpuIds = excludedCrossGroupSpuIds(siblingSkus);
  const excludedSpu = Boolean(sku.spuId && excludedSpuIds.has(sku.spuId));

  const warehouseLookups =
    input.warehouseCode === DEMAND_PLAN_WAREHOUSE_ALL
      ? [DEMAND_PLAN_WAREHOUSE_ALL]
      : [DEMAND_PLAN_WAREHOUSE_ALL, input.warehouseCode];

  let adoption: LoadPlanningDemandAdoption | undefined;
  let adoptionProjectGroup: string | null = sku.projectGroup;
  let adoptionWarehouse = input.warehouseCode;
  const resolvedAdoption = await resolvePlanningAdoption({
    projectGroup: sku.projectGroup,
    warehouseCode: input.warehouseCode,
    loadAdoption,
  });
  if (resolvedAdoption) {
    adoption = resolvedAdoption.adoption;
    adoptionProjectGroup = resolvedAdoption.adoptionProjectGroup;
    adoptionWarehouse = resolvedAdoption.adoptionWarehouse;
  }
  const adoptionSource = adoption?.source === 'demand_plan' ? 'demand_plan' : 'forecast';

  let demandRows: Array<{
    period: string;
    systemDailyAvg: number;
    manualDailyAvg: number | null;
  }> = [];
  if (adoptionSource === 'demand_plan' && adoptionProjectGroup) {
    for (const warehouseCode of warehouseLookups) {
      demandRows = parseDemandPlanMonthlyNumbers(
        await loadPublishedDemandRows({
          skuId: input.skuId,
          warehouseCode,
          projectGroup: adoptionProjectGroup,
        }),
      );
      if (demandRows.length) {
        adoptionWarehouse = warehouseCode;
        break;
      }
    }
    if (
      demandRows.length &&
      adoptionWarehouse === DEMAND_PLAN_WAREHOUSE_ALL &&
      input.warehouseCode !== DEMAND_PLAN_WAREHOUSE_ALL
    ) {
      if (share == null) {
        demandRows = [];
      } else {
        demandRows = scaleDemandRowsByShare(demandRows, share);
      }
    }
  }

  return resolvePlanningDemandFromInputs({
    pilotEnabled: true,
    adoptionSource,
    excludedSpu,
    hasShare,
    demandRows,
    championWarehouseRows,
    stationForecastMap: input.championForecastMap,
    networkScope,
  });
}
