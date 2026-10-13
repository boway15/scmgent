import {
  db,
  inventoryDailySnapshots,
  inventoryHealthSnapshots,
  purchaseDrafts,
  reorderSuggestions,
  salesForecastMonthly,
  salesForecastVersions,
  salesHistory,
  shipmentMilestones,
  shipments,
  skus,
  stockAlerts,
} from '@scm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
import { buildPlanningExcludedSqlCondition } from './commercial-status.js';
import { calcMilestoneDelayDays } from './shipment-delay.js';
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
  delayedShipments: number;
  delayedDraftsEtaAvailable: number;
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

type ShipmentForDashboard = {
  status: string;
  etaAvailable: string | null;
  milestones: Array<{
    plannedAt: string | null;
    actualAt: string | null;
  }>;
};

type PurchaseDraftForDashboard = {
  status: string;
  etaAvailable: string | null;
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
  /** 已在 SQL 中计过数时直接使用，避免把发运和跟单整表拉进内存 */
  delayedShipmentCount?: number;
  delayedDraftCount?: number;
  shipments: ShipmentForDashboard[];
  purchaseDrafts: PurchaseDraftForDashboard[];
  stockoutHorizon7?: number;
  stockoutHorizon15?: number;
  stockoutHorizon30?: number;
  overstockCount?: number;
  uncoverableByNewPoCount?: number;
};

const TERMINAL_SHIPMENT_STATUSES = ['available', 'cancelled'];

function isTerminalDraftStatus(status: string): boolean {
  return status === 'received' || status === 'cancelled';
}

function isDelayedShipment(shipment: ShipmentForDashboard, today: Date): boolean {
  if (TERMINAL_SHIPMENT_STATUSES.includes(shipment.status)) return false;

  const etaDelay = calcMilestoneDelayDays(shipment.etaAvailable, null, today) ?? 0;
  if (etaDelay > 0) return true;

  return shipment.milestones.some(
    (milestone) =>
      (calcMilestoneDelayDays(milestone.plannedAt, milestone.actualAt, today) ?? 0) > 0,
  );
}

export function aggregatePlanningDashboard(
  source: PlanningDashboardSource,
  today: Date = new Date(),
): PlanningDashboard {
  const todayDate = today.toISOString().slice(0, 10);
  const delayedDraftsEtaAvailable =
    source.delayedDraftCount ??
    source.purchaseDrafts.filter(
      (draft) =>
        draft.etaAvailable != null &&
        draft.etaAvailable < todayDate &&
        !isTerminalDraftStatus(draft.status),
    ).length;

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
    delayedShipments:
      source.delayedShipmentCount ??
      source.shipments.filter((shipment) => isDelayedShipment(shipment, today)).length,
    delayedDraftsEtaAvailable,
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

function firstCount(rows: Array<{ count: number }>): number {
  return Number(rows[0]?.count ?? 0);
}

export async function getPlanningDashboard(
  today: Date = new Date(),
  productScope: ProductScope = 'goods',
): Promise<PlanningDashboard> {
  const skuScopeSql = productScopeOnSkuAlias(productScope, 's');
  const todayDate = today.toISOString().slice(0, 10);
  const [
    metricsResult,
    pendingSuggestionRows,
    delayedShipmentRows,
    delayedDraftRows,
    openDataIssueCount,
    openUnallocatedLotCount,
  ] = await Promise.all([
    db.execute(sql`
      WITH active_skus AS (
        SELECT s.id
        FROM ${skus} s
        WHERE s.is_active = true
        ${skuScopeSql}
      ),
      operational_skus AS (
        SELECT s.id, s.lifecycle, s.commercial_status_norm
        FROM ${skus} s
        WHERE s.is_active = true
        ${skuScopeSql}
          AND (
            EXISTS (
              SELECT 1
              FROM ${inventoryDailySnapshots} ids
              WHERE ids.sku_id = s.id
                AND ids.snapshot_date >= (CURRENT_DATE - ${sql.raw(String(OPERATIONAL_TURNOVER_LOOKBACK_DAYS))} * INTERVAL '1 day')
            )
            OR EXISTS (
              SELECT 1
              FROM ${salesHistory} sh
              WHERE sh.sku_id = s.id
                AND sh.sale_date >= (CURRENT_DATE - ${sql.raw(String(OPERATIONAL_SALES_LOOKBACK_DAYS))} * INTERVAL '1 day')
                AND sh.qty_sold > 0
            )
          )
      ),
      gray_skus AS (
        SELECT id FROM operational_skus WHERE ${sql.raw(planningExcludedSql)}
      ),
      eligible_skus AS (
        SELECT id FROM operational_skus WHERE id NOT IN (SELECT id FROM gray_skus)
      ),
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
          SELECT count(*)::int
          FROM eligible_skus es
          WHERE es.id NOT IN (SELECT id FROM forecast_covered)
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
    db.execute(sql`
      SELECT count(*)::int AS count
      FROM ${shipments} s
      WHERE s.status NOT IN ('available', 'cancelled')
        AND (
          (s.eta_available IS NOT NULL AND s.eta_available < CAST(${todayDate} AS date))
          OR EXISTS (
            SELECT 1
            FROM ${shipmentMilestones} m
            WHERE m.shipment_id = s.id
              AND m.planned_at IS NOT NULL
              AND (
                (m.actual_at IS NULL AND m.planned_at < CAST(${todayDate} AS date))
                OR (m.actual_at IS NOT NULL AND m.planned_at < m.actual_at)
              )
          )
        )
    `),
    db.execute(sql`
      SELECT count(*)::int AS count
      FROM ${purchaseDrafts}
      WHERE eta_available IS NOT NULL
        AND eta_available < CAST(${todayDate} AS date)
        AND status NOT IN ('received', 'cancelled')
    `),
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
      delayedShipmentCount: firstCount(
        Array.from(delayedShipmentRows as unknown as Array<{ count: number }>),
      ),
      delayedDraftCount: firstCount(
        Array.from(delayedDraftRows as unknown as Array<{ count: number }>),
      ),
      shipments: [],
      purchaseDrafts: [],
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
