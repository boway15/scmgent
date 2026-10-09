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
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';
import { buildPlanningExcludedSqlCondition } from './commercial-status.js';
import { calcMilestoneDelayDays } from './shipment-delay.js';
import { countOpenDataIssues } from './inventory-data-issue-store.js';
import { countOpenUnallocatedLots } from './inventory-dest-allocation-store.js';
import { getInventoryRiskCounts, type InventoryRiskCounts } from './alert-action-index.js';
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
  inventoryRisk?: InventoryRiskCounts;
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
  const delayedDraftsEtaAvailable = source.purchaseDrafts.filter(
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
    delayedShipments: source.shipments.filter((shipment) =>
      isDelayedShipment(shipment, today),
    ).length,
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

type HealthCountRow = {
  healthRedCount: number;
  healthYellowCount: number;
  healthRedSkuCount: number;
  healthYellowSkuCount: number;
};

type SkuCompositionRow = {
  skuActiveCount: number;
  skuOperationalCount: number;
  skuDormantCount: number;
  skuGrayLifecycleCount: number;
  skuPlanningEligibleCount: number;
  skuForecastCoveredCount: number;
  skuForecastGapCount: number;
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
  const [
    skuCompositionResult,
    healthResult,
    belowRopRows,
    pendingSuggestionRows,
    shipmentRows,
    draftRows,
    horizon7Rows,
    horizon15Rows,
    horizon30Rows,
    overstockRows,
    uncoverableByNewPoRows,
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
        ) AS "skuForecastGapCount"
    `),
    db.execute(sql`
      WITH operational_skus AS (
        SELECT s.id
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
      )
      SELECT
        count(*) FILTER (WHERE health_status = 'red')::int AS "healthRedCount",
        count(*) FILTER (WHERE health_status = 'yellow')::int AS "healthYellowCount",
        (SELECT count(*)::int FROM sku_health WHERE has_red) AS "healthRedSkuCount",
        (
          SELECT count(*)::int
          FROM sku_health
          WHERE has_yellow AND NOT has_red
        ) AS "healthYellowSkuCount"
      FROM latest_health
    `),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.alertType, 'below_rop'), eq(stockAlerts.isResolved, false))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reorderSuggestions)
      .where(
        and(eq(reorderSuggestions.status, 'pending'), isNull(reorderSuggestions.supersededAt)),
      ),
    db
      .select({
        id: shipments.id,
        status: shipments.status,
        etaAvailable: shipments.etaAvailable,
      })
      .from(shipments)
      .where(notInArray(shipments.status, TERMINAL_SHIPMENT_STATUSES)),
    db
      .select({
        status: purchaseDrafts.status,
        etaAvailable: purchaseDrafts.etaAvailable,
      })
      .from(purchaseDrafts)
      .where(
        and(
          isNotNull(purchaseDrafts.etaAvailable),
          notInArray(purchaseDrafts.status, ['received', 'cancelled']),
        ),
      ),
    db
      .select({ count: sql<number>`count(DISTINCT sku_id)::int` })
      .from(stockAlerts)
      .where(
        and(
          eq(stockAlerts.alertType, 'stockout_horizon'),
          eq(stockAlerts.horizonDays, 7),
          eq(stockAlerts.isResolved, false),
        ),
      ),
    db
      .select({ count: sql<number>`count(DISTINCT sku_id)::int` })
      .from(stockAlerts)
      .where(
        and(
          eq(stockAlerts.alertType, 'stockout_horizon'),
          eq(stockAlerts.horizonDays, 15),
          eq(stockAlerts.isResolved, false),
        ),
      ),
    db
      .select({ count: sql<number>`count(DISTINCT sku_id)::int` })
      .from(stockAlerts)
      .where(
        and(
          eq(stockAlerts.alertType, 'stockout_horizon'),
          eq(stockAlerts.horizonDays, 30),
          eq(stockAlerts.isResolved, false),
        ),
      ),
    db
      .select({ count: sql<number>`count(DISTINCT sku_id)::int` })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.alertType, 'overstock'), eq(stockAlerts.isResolved, false))),
    db
      .select({ count: sql<number>`count(DISTINCT sku_id)::int` })
      .from(stockAlerts)
      .where(
        and(eq(stockAlerts.alertType, 'uncoverable_by_new_po'), eq(stockAlerts.isResolved, false)),
      ),
  ]);

  const milestones =
    shipmentRows.length === 0
      ? []
      : await db
          .select({
            shipmentId: shipmentMilestones.shipmentId,
            plannedAt: shipmentMilestones.plannedAt,
            actualAt: shipmentMilestones.actualAt,
          })
          .from(shipmentMilestones)
          .where(
            inArray(
              shipmentMilestones.shipmentId,
              shipmentRows.map((row) => row.id),
            ),
          );
  const milestonesByShipment = new Map<string, typeof milestones>();
  for (const milestone of milestones) {
    const rows = milestonesByShipment.get(milestone.shipmentId) ?? [];
    rows.push(milestone);
    milestonesByShipment.set(milestone.shipmentId, rows);
  }

  const skuCompositionRows = Array.from(skuCompositionResult as unknown as SkuCompositionRow[]);
  const skuComposition = skuCompositionRows[0];
  const healthRows = Array.from(healthResult as unknown as HealthCountRow[]);
  const health = healthRows[0];
  const dashboard = aggregatePlanningDashboard(
    {
      skuActiveCount: Number(skuComposition?.skuActiveCount ?? 0),
      skuOperationalCount: Number(skuComposition?.skuOperationalCount ?? 0),
      skuDormantCount: Number(skuComposition?.skuDormantCount ?? 0),
      skuPlanningEligibleCount: Number(skuComposition?.skuPlanningEligibleCount ?? 0),
      skuGrayLifecycleCount: Number(skuComposition?.skuGrayLifecycleCount ?? 0),
      skuForecastCoveredCount: Number(skuComposition?.skuForecastCoveredCount ?? 0),
      skuForecastGapCount: Number(skuComposition?.skuForecastGapCount ?? 0),
      healthRedCount: Number(health?.healthRedCount ?? 0),
      healthYellowCount: Number(health?.healthYellowCount ?? 0),
      healthRedSkuCount: Number(health?.healthRedSkuCount ?? 0),
      healthYellowSkuCount: Number(health?.healthYellowSkuCount ?? 0),
      belowRopCount: firstCount(belowRopRows),
      pendingSuggestions: firstCount(pendingSuggestionRows),
      shipments: shipmentRows.map((shipment) => ({
        status: shipment.status,
        etaAvailable: shipment.etaAvailable,
        milestones: milestonesByShipment.get(shipment.id) ?? [],
      })),
      purchaseDrafts: draftRows,
      stockoutHorizon7: firstCount(horizon7Rows),
      stockoutHorizon15: firstCount(horizon15Rows),
      stockoutHorizon30: firstCount(horizon30Rows),
      overstockCount: firstCount(overstockRows),
      uncoverableByNewPoCount: firstCount(uncoverableByNewPoRows),
    },
    today,
  );
  const [openDataIssueCount, openUnallocatedLotCount, inventoryRisk] = await Promise.all([
    countOpenDataIssues(),
    countOpenUnallocatedLots(),
    getInventoryRiskCounts(productScope),
  ]);
  return {
    ...dashboard,
    openDataIssueCount,
    openUnallocatedLotCount,
    inventoryRisk,
  };
}
