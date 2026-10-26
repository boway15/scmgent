import {
  db,
  demandPlanVersions,
  inventoryHealthSnapshots,
  planningDemandAdoptions,
  salesForecastVersions,
  salesHistory,
  skus,
} from '@scm/db';
import { desc, eq, sql } from 'drizzle-orm';
import { buildPlanningExcludedSqlCondition } from './commercial-status.js';
import { productScopeOnSkuAlias } from './planning-accessory-filter.js';

/** 动销窗口锚定销量数据截止日，导入滞后不会缩小分母 */
const SELLING_LOOKBACK_DAYS = 90;

const planningExcludedSql = buildPlanningExcludedSqlCondition({
  lifecycleColumnSql: 's.lifecycle',
  commercialStatusNormColumnSql: 's.commercial_status_norm',
});

export type PlanningDemandSource = {
  publishedForecast: {
    versionCount: number;
    latest: {
      versionNo: string;
      versionName: string;
      station: string | null;
      startMonth: string | null;
      publishedAt: string | null;
    } | null;
  };
  demandPlanAdoptions: Array<{
    projectGroup: string;
    warehouseCode: string;
    versionNo: string | null;
    versionName: string | null;
    adoptedAt: string;
  }>;
  latestHealth: {
    computedAt: string | null;
    forecastRows: number;
    historicalRows: number;
    /** 动销 SKU：非配件、非停售，且销量截止日前 90 天有销量 */
    sellingSkus: number;
    sellingForecastSkus: number;
    sellingHistoricalSkus: number;
  };
  salesHistoryMaxDate: string | null;
};

type HealthSourceRow = {
  demand_source: string;
  rows: number;
  computed_at: Date | string | null;
};

type SellingCoverageRow = {
  selling_skus: number;
  forecast_skus: number;
  historical_skus: number;
};

const DEMAND_SOURCE_FRESH_MS = 10 * 60_000;
const DEMAND_SOURCE_STALE_MS = 60 * 60_000;
let demandSourceCache: { at: number; data: PlanningDemandSource } | null = null;
let demandSourceInflight: Promise<PlanningDemandSource> | null = null;
let demandSourceCacheGen = 0;

export function invalidatePlanningDemandSourceCache(): void {
  demandSourceCacheGen += 1;
  demandSourceCache = null;
  demandSourceInflight = null;
}

function refreshPlanningDemandSourceCache(): Promise<PlanningDemandSource> {
  if (demandSourceInflight) return demandSourceInflight;

  const gen = demandSourceCacheGen;
  const promise = queryPlanningDemandSource()
    .then((data) => {
      if (gen === demandSourceCacheGen) {
        demandSourceCache = { at: Date.now(), data };
      }
      return data;
    })
    .finally(() => {
      if (demandSourceInflight === promise) {
        demandSourceInflight = null;
      }
    });

  demandSourceInflight = promise;
  return promise;
}

export async function getPlanningDemandSource(): Promise<PlanningDemandSource> {
  if (demandSourceCache) {
    const age = Date.now() - demandSourceCache.at;
    if (age < DEMAND_SOURCE_FRESH_MS) {
      return demandSourceCache.data;
    }
    if (age < DEMAND_SOURCE_STALE_MS) {
      void refreshPlanningDemandSourceCache().catch((err) => {
        console.warn('[planning-demand-source] background cache refresh failed:', err);
      });
      return demandSourceCache.data;
    }
  }

  return refreshPlanningDemandSourceCache();
}

async function queryPlanningDemandSource(): Promise<PlanningDemandSource> {
  const [publishedRows, adoptionRows, healthRows, sellingRows, salesMaxRows] = await Promise.all([
    db
      .select({
        versionNo: salesForecastVersions.versionNo,
        versionName: salesForecastVersions.versionName,
        station: salesForecastVersions.station,
        startMonth: salesForecastVersions.startMonth,
        publishedAt: salesForecastVersions.publishedAt,
      })
      .from(salesForecastVersions)
      .where(eq(salesForecastVersions.status, 'published'))
      .orderBy(sql`${salesForecastVersions.publishedAt} DESC NULLS LAST`),
    db
      .select({
        projectGroup: planningDemandAdoptions.projectGroup,
        warehouseCode: planningDemandAdoptions.warehouseCode,
        versionNo: demandPlanVersions.versionNo,
        versionName: demandPlanVersions.versionName,
        adoptedAt: planningDemandAdoptions.adoptedAt,
      })
      .from(planningDemandAdoptions)
      .leftJoin(
        demandPlanVersions,
        eq(planningDemandAdoptions.demandPlanVersionId, demandPlanVersions.id),
      )
      .where(eq(planningDemandAdoptions.source, 'demand_plan'))
      .orderBy(desc(planningDemandAdoptions.adoptedAt)),
    // Every writer saves a full batch with one shared computed_at.
    db.execute(sql`
      WITH latest_batch AS (
        SELECT max(computed_at) AS computed_at FROM ${inventoryHealthSnapshots}
      )
      SELECT h.demand_source, count(*)::int AS rows, max(h.computed_at) AS computed_at
      FROM ${inventoryHealthSnapshots} h, latest_batch b
      WHERE h.computed_at = b.computed_at
      GROUP BY h.demand_source
    `),
    db.execute(sql`
      WITH latest_batch AS (
        SELECT max(computed_at) AS computed_at FROM ${inventoryHealthSnapshots}
      ),
      max_sale AS (
        SELECT max(sale_date) AS max_date FROM ${salesHistory}
      ),
      recent_sold_skus AS (
        SELECT DISTINCT sh.sku_id
        FROM ${salesHistory} sh
        CROSS JOIN max_sale ms
        WHERE sh.qty_sold > 0
          AND sh.sale_date > ms.max_date - ${sql.raw(String(SELLING_LOOKBACK_DAYS))}
      ),
      selling_skus AS (
        SELECT s.id
        FROM ${skus} s
        INNER JOIN recent_sold_skus rss ON rss.sku_id = s.id
        WHERE s.is_active = true
        ${productScopeOnSkuAlias('goods', 's')}
          AND NOT coalesce(${sql.raw(planningExcludedSql)}, false)
      ),
      batch_skus AS (
        SELECT h.sku_id, bool_or(h.demand_source = 'forecast') AS has_forecast
        FROM ${inventoryHealthSnapshots} h, latest_batch b
        WHERE h.computed_at = b.computed_at
        GROUP BY h.sku_id
      )
      SELECT
        count(*)::int AS selling_skus,
        count(*) FILTER (WHERE bs.has_forecast)::int AS forecast_skus,
        count(*) FILTER (WHERE NOT bs.has_forecast)::int AS historical_skus
      FROM selling_skus ss
      INNER JOIN batch_skus bs ON bs.sku_id = ss.id
    `),
    db.select({ maxDate: sql<string | null>`max(${salesHistory.saleDate})::text` }).from(salesHistory),
  ]);

  const latest = publishedRows[0];
  const healthList = Array.from(healthRows as unknown as HealthSourceRow[]);
  const selling = Array.from(sellingRows as unknown as SellingCoverageRow[])[0];

  let forecastRows = 0;
  let historicalRows = 0;
  let computedAt: Date | null = null;
  for (const row of healthList) {
    if (row.demand_source === 'forecast') forecastRows += Number(row.rows);
    else historicalRows += Number(row.rows);
    if (row.computed_at) {
      const at = new Date(row.computed_at);
      if (!computedAt || at > computedAt) computedAt = at;
    }
  }

  return {
    publishedForecast: {
      versionCount: publishedRows.length,
      latest: latest
        ? {
            versionNo: latest.versionNo,
            versionName: latest.versionName,
            station: latest.station,
            startMonth: latest.startMonth,
            publishedAt: latest.publishedAt?.toISOString() ?? null,
          }
        : null,
    },
    demandPlanAdoptions: adoptionRows.map((row) => ({
      projectGroup: row.projectGroup,
      warehouseCode: row.warehouseCode,
      versionNo: row.versionNo,
      versionName: row.versionName,
      adoptedAt: row.adoptedAt.toISOString(),
    })),
    latestHealth: {
      computedAt: computedAt?.toISOString() ?? null,
      forecastRows,
      historicalRows,
      sellingSkus: Number(selling?.selling_skus ?? 0),
      sellingForecastSkus: Number(selling?.forecast_skus ?? 0),
      sellingHistoricalSkus: Number(selling?.historical_skus ?? 0),
    },
    salesHistoryMaxDate: salesMaxRows[0]?.maxDate ?? null,
  };
}
