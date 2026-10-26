import {
  db,
  inventoryDailySnapshots,
  inventoryHealthSnapshots,
  reorderSuggestions,
  salesForecastMonthly,
  salesForecastVersions,
  salesHistory,
  skus,
  stockAlerts,
} from '@scm/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
import { buildPlanningExcludedSqlCondition } from './commercial-status.js';
import { countOpenDataIssues } from './inventory-data-issue-store.js';
import { countOpenUnallocatedLots } from './inventory-dest-allocation-store.js';
import { productScopeOnSkuAlias, type ProductScope } from './planning-accessory-filter.js';

/** 近 30 天周转表 或 近 90 天有销量（qty_sold > 0） */
export const OPERATIONAL_TURNOVER_LOOKBACK_DAYS = 30;
export const OPERATIONAL_SALES_LOOKBACK_DAYS = 90;

export type PlanningDashboard = {
  skuActiveCount: number;
  skuOperationalCount: number;
  skuDormantCount: number;
  skuPlanningEligibleCount: number;
  skuGrayLifecycleCount: number;
  skuForecastCoveredCount: number;
  skuForecastGapCount: number;
  forecastCoverageRate: number;
  healthRedCount: number;
  healthYellowCount: number;
  healthRedSkuCount: number;
  healthYellowSkuCount: number;
  belowRopCount: number;
  pendingSuggestions: number;
  stockoutRateApprox: number;
  stockoutHorizon7: number;
  stockoutHorizon15: number;
  stockoutHorizon30: number;
  overstockCount: number;
  uncoverableByNewPoCount: number;
  pendingShipOut: number;
  pendingTransfer: number;
  calculatedAt: string;
  openDataIssueCount?: number;
  openUnallocatedLotCount?: number;
};

export type PlanningDashboardSource = {
  skuActiveCount: number;
  skuOperationalCount: number;
  skuDormantCount: number;
  skuPlanningEligibleCount: number;
  skuGrayLifecycleCount: number;
  skuForecastCoveredCount: number;
  skuForecastGapCount: number;
  healthRedCount: number;
  healthYellowCount: number;
  healthRedSkuCount: number;
  healthYellowSkuCount: number;
  belowRopCount: number;
  pendingSuggestions: number;
  stockoutHorizon7?: number;
  stockoutHorizon15?: number;
  stockoutHorizon30?: number;
  overstockCount?: number;
  uncoverableByNewPoCount?: number;
};

export function aggregatePlanningDashboard(
  source: PlanningDashboardSource,
  today: Date = new Date(),
): PlanningDashboard {
  const planningEligible = source.skuPlanningEligibleCount;
  return {
    skuActiveCount: source.skuActiveCount,
    skuOperationalCount: source.skuOperationalCount,
    skuDormantCount: source.skuDormantCount,
    skuPlanningEligibleCount: planningEligible,
    skuGrayLifecycleCount: source.skuGrayLifecycleCount,
    skuForecastCoveredCount: source.skuForecastCoveredCount,
    skuForecastGapCount: source.skuForecastGapCount,
    forecastCoverageRate:
      planningEligible > 0 ? source.skuForecastCoveredCount / planningEligible : 0,
    healthRedCount: source.healthRedCount,
    healthYellowCount: source.healthYellowCount,
    healthRedSkuCount: source.healthRedSkuCount,
    healthYellowSkuCount: source.healthYellowSkuCount,
    belowRopCount: source.belowRopCount,
    pendingSuggestions: source.pendingSuggestions,
    stockoutRateApprox:
      planningEligible > 0 ? source.healthRedSkuCount / planningEligible : 0,
    stockoutHorizon7: source.stockoutHorizon7 ?? 0,
    stockoutHorizon15: source.stockoutHorizon15 ?? 0,
    stockoutHorizon30: source.stockoutHorizon30 ?? 0,
    overstockCount: source.overstockCount ?? 0,
    uncoverableByNewPoCount: source.uncoverableByNewPoCount ?? 0,
    pendingShipOut: 0,
    pendingTransfer: 0,
    calculatedAt: today.toISOString(),
  };
}

type DashboardMetricsRow = {
  skuActiveCount: number;
  skuOperationalCount: number;
  skuDormantCount: number;
  skuGrayLifecycleCount: number;
  skuPlanningEligibleCount: number;
  skuForecastCoveredCount: number;
  skuForecastGapCount: number;
  healthRedCount: number;
  healthYellowCount: number;
  healthRedSkuCount: number;
  healthYellowSkuCount: number;
  belowRopCount: number;
  stockoutHorizon7: number;
  stockoutHorizon15: number;
  stockoutHorizon30: number;
  overstockCount: number;
  uncoverableByNewPoCount: number;
};

const planningExcludedSql = buildPlanningExcludedSqlCondition({
  lifecycleColumnSql: 'lifecycle',
  commercialStatusNormColumnSql: 'commercial_status_norm',
});

/** 运营 SKU（近期周转或有销）排除疑似停售 = 可规划 SKU；产出 active_skus / operational_skus / gray_skus / eligible_skus */
function planningEligibleCtes(skuScopeSql: SQL): SQL {
  return sql`
      active_skus AS (
        SELECT s.id
        FROM ${skus} s
        WHERE s.is_active = true
        ${skuScopeSql}
      ),
      recent_turnover_skus AS (
        SELECT DISTINCT sku_id
        FROM ${inventoryDailySnapshots}
        WHERE snapshot_date >= (CURRENT_DATE - ${sql.raw(String(OPERATIONAL_TURNOVER_LOOKBACK_DAYS))} * INTERVAL '1 day')
      ),
      recent_sales_skus AS (
        SELECT DISTINCT sku_id
        FROM ${salesHistory}
        WHERE sale_date >= (CURRENT_DATE - ${sql.raw(String(OPERATIONAL_SALES_LOOKBACK_DAYS))} * INTERVAL '1 day')
          AND qty_sold > 0
      ),
      operational_union AS (
        SELECT sku_id FROM recent_turnover_skus
        UNION
        SELECT sku_id FROM recent_sales_skus
      ),
      operational_skus AS (
        SELECT s.id, s.lifecycle, s.commercial_status_norm
        FROM ${skus} s
        INNER JOIN operational_union ou ON ou.sku_id = s.id
        WHERE s.is_active = true
        ${skuScopeSql}
      ),
      gray_skus AS (
        SELECT id FROM operational_skus WHERE ${sql.raw(planningExcludedSql)}
      ),
      eligible_skus AS (
        SELECT os.id
        FROM operational_skus os
        LEFT JOIN gray_skus gs ON gs.id = os.id
        WHERE gs.id IS NULL
      )`;
}

/** 可规划 SKU 全集（成品 + 配件），预警只对这些 SKU 落库 */
export async function loadPlanningEligibleSkuIds(): Promise<Set<string>> {
  const rows = await db.execute(sql`
    WITH ${planningEligibleCtes(sql``)}
    SELECT id FROM eligible_skus
  `);
  return new Set(Array.from(rows as unknown as Array<{ id: string }>).map((row) => row.id));
}

function firstCount(rows: Array<{ count: number }>): number {
  return Number(rows[0]?.count ?? 0);
}

const DASHBOARD_FRESH_MS = 10 * 60_000;
const DASHBOARD_STALE_MS = 60 * 60_000;
type DashboardCacheEntry = { at: number; data: PlanningDashboard };
const dashboardCache = new Map<string, DashboardCacheEntry>();
const dashboardInflight = new Map<string, Promise<PlanningDashboard>>();
let dashboardCacheGen = 0;

export function invalidatePlanningDashboardCache(): void {
  dashboardCacheGen += 1;
  dashboardCache.clear();
  dashboardInflight.clear();
}

function refreshPlanningDashboardCache(
  cacheKey: string,
  effectiveToday: Date,
  productScope: ProductScope,
): Promise<PlanningDashboard> {
  const existing = dashboardInflight.get(cacheKey);
  if (existing) return existing;

  const gen = dashboardCacheGen;
  const promise = queryPlanningDashboard(effectiveToday, productScope)
    .then((data) => {
      if (gen === dashboardCacheGen) {
        dashboardCache.set(cacheKey, { at: Date.now(), data });
      }
      return data;
    })
    .finally(() => {
      if (dashboardInflight.get(cacheKey) === promise) {
        dashboardInflight.delete(cacheKey);
      }
    });

  dashboardInflight.set(cacheKey, promise);
  return promise;
}

export async function getPlanningDashboard(
  today?: Date,
  productScope: ProductScope = 'goods',
): Promise<PlanningDashboard> {
  const effectiveToday = today ?? new Date();
  const todayDate = effectiveToday.toISOString().slice(0, 10);
  const cacheKey = `${productScope}::${todayDate}`;

  if (today !== undefined) {
    return queryPlanningDashboard(effectiveToday, productScope);
  }

  const hit = dashboardCache.get(cacheKey);
  if (hit) {
    const age = Date.now() - hit.at;
    if (age < DASHBOARD_FRESH_MS) {
      return hit.data;
    }
    if (age < DASHBOARD_STALE_MS) {
      void refreshPlanningDashboardCache(cacheKey, effectiveToday, productScope).catch((err) => {
        console.warn('[planning-dashboard] background cache refresh failed:', err);
      });
      return hit.data;
    }
  }

  return refreshPlanningDashboardCache(cacheKey, effectiveToday, productScope);
}

async function queryPlanningDashboard(
  today: Date,
  productScope: ProductScope,
): Promise<PlanningDashboard> {
  const skuScopeSql = productScopeOnSkuAlias(productScope, 's');
  const [
    metricsResult,
    pendingSuggestionRows,
    openDataIssueCount,
    openUnallocatedLotCount,
  ] = await Promise.all([
    db.execute(sql`
      WITH ${planningEligibleCtes(skuScopeSql)},
      forecast_covered AS (
        SELECT DISTINCT es.id
        FROM eligible_skus es
        INNER JOIN ${salesForecastMonthly} fm ON fm.sku_id = es.id
        INNER JOIN ${salesForecastVersions} fv
          ON fv.id = fm.version_id AND fv.status = 'published'
        WHERE fm.station = ${FORECAST_GLOBAL_STATION}
      ),
      latest_health AS (
        SELECT DISTINCT ON (h.sku_id, h.warehouse_code)
          h.sku_id,
          h.health_status
        FROM ${inventoryHealthSnapshots} h
        INNER JOIN operational_skus os ON os.id = h.sku_id
        ORDER BY h.sku_id, h.warehouse_code, h.computed_at DESC, h.id DESC
      ),
      sku_health AS (
        SELECT
          sku_id,
          bool_or(health_status = 'red') AS has_red,
          bool_or(health_status = 'yellow') AS has_yellow
        FROM latest_health
        GROUP BY sku_id
      ),
      alert_counts AS (
        SELECT
          count(*) FILTER (WHERE alert_type = 'below_rop' AND is_resolved = false)::int AS below_rop,
          count(DISTINCT sku_id) FILTER (
            WHERE alert_type = 'stockout_horizon' AND horizon_days = 7 AND is_resolved = false
          )::int AS horizon7,
          count(DISTINCT sku_id) FILTER (
            WHERE alert_type = 'stockout_horizon' AND horizon_days = 15 AND is_resolved = false
          )::int AS horizon15,
          count(DISTINCT sku_id) FILTER (
            WHERE alert_type = 'stockout_horizon' AND horizon_days = 30 AND is_resolved = false
          )::int AS horizon30,
          count(DISTINCT sku_id) FILTER (
            WHERE alert_type = 'overstock' AND is_resolved = false
          )::int AS overstock,
          count(DISTINCT sku_id) FILTER (
            WHERE alert_type = 'uncoverable_by_new_po' AND is_resolved = false
          )::int AS uncoverable
        FROM ${stockAlerts}
      )
      SELECT
        (SELECT count(*)::int FROM active_skus) AS "skuActiveCount",
        (SELECT count(*)::int FROM operational_skus) AS "skuOperationalCount",
        (
          (SELECT count(*)::int FROM active_skus)
          - (SELECT count(*)::int FROM operational_skus)
        ) AS "skuDormantCount",
        (SELECT count(*)::int FROM gray_skus) AS "skuGrayLifecycleCount",
        (SELECT count(*)::int FROM eligible_skus) AS "skuPlanningEligibleCount",
        (SELECT count(*)::int FROM forecast_covered) AS "skuForecastCoveredCount",
        (
          (SELECT count(*)::int FROM eligible_skus)
          - (SELECT count(*)::int FROM forecast_covered)
        ) AS "skuForecastGapCount",
        (SELECT count(*) FILTER (WHERE health_status = 'red')::int FROM latest_health) AS "healthRedCount",
        (SELECT count(*) FILTER (WHERE health_status = 'yellow')::int FROM latest_health) AS "healthYellowCount",
        (SELECT count(*)::int FROM sku_health WHERE has_red) AS "healthRedSkuCount",
        (SELECT count(*)::int FROM sku_health WHERE has_yellow AND NOT has_red) AS "healthYellowSkuCount",
        (SELECT below_rop FROM alert_counts) AS "belowRopCount",
        (SELECT horizon7 FROM alert_counts) AS "stockoutHorizon7",
        (SELECT horizon15 FROM alert_counts) AS "stockoutHorizon15",
        (SELECT horizon30 FROM alert_counts) AS "stockoutHorizon30",
        (SELECT overstock FROM alert_counts) AS "overstockCount",
        (SELECT uncoverable FROM alert_counts) AS "uncoverableByNewPoCount"
    `),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reorderSuggestions)
      .where(
        and(eq(reorderSuggestions.status, 'pending'), isNull(reorderSuggestions.supersededAt)),
      ),
    countOpenDataIssues(),
    countOpenUnallocatedLots(),
  ]);

  const metrics = Array.from(metricsResult as unknown as DashboardMetricsRow[])[0];
  const dashboard = aggregatePlanningDashboard(
    {
      skuActiveCount: Number(metrics?.skuActiveCount ?? 0),
      skuOperationalCount: Number(metrics?.skuOperationalCount ?? 0),
      skuDormantCount: Number(metrics?.skuDormantCount ?? 0),
      skuPlanningEligibleCount: Number(metrics?.skuPlanningEligibleCount ?? 0),
      skuGrayLifecycleCount: Number(metrics?.skuGrayLifecycleCount ?? 0),
      skuForecastCoveredCount: Number(metrics?.skuForecastCoveredCount ?? 0),
      skuForecastGapCount: Number(metrics?.skuForecastGapCount ?? 0),
      healthRedCount: Number(metrics?.healthRedCount ?? 0),
      healthYellowCount: Number(metrics?.healthYellowCount ?? 0),
      healthRedSkuCount: Number(metrics?.healthRedSkuCount ?? 0),
      healthYellowSkuCount: Number(metrics?.healthYellowSkuCount ?? 0),
      belowRopCount: Number(metrics?.belowRopCount ?? 0),
      pendingSuggestions: firstCount(pendingSuggestionRows),
      stockoutHorizon7: Number(metrics?.stockoutHorizon7 ?? 0),
      stockoutHorizon15: Number(metrics?.stockoutHorizon15 ?? 0),
      stockoutHorizon30: Number(metrics?.stockoutHorizon30 ?? 0),
      overstockCount: Number(metrics?.overstockCount ?? 0),
      uncoverableByNewPoCount: Number(metrics?.uncoverableByNewPoCount ?? 0),
    },
    today,
  );
  return {
    ...dashboard,
    openDataIssueCount,
    openUnallocatedLotCount,
  };
}
