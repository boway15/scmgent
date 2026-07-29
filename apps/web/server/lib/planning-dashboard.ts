import {
  db,
  inventoryHealthSnapshots,
  purchaseDrafts,
  reorderSuggestions,
  shipmentMilestones,
  shipments,
  skus,
  stockAlerts,
} from '@scm/db';
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { calcMilestoneDelayDays } from './shipment-delay.js';

export type PlanningDashboard = {
  skuActiveCount: number;
  healthRedCount: number;
  healthYellowCount: number;
  belowRopCount: number;
  pendingSuggestions: number;
  delayedShipments: number;
  delayedDraftsEtaAvailable: number;
  stockoutRateApprox: number;
  calculatedAt: string;
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
  healthRedCount: number;
  healthYellowCount: number;
  belowRopCount: number;
  pendingSuggestions: number;
  shipments: ShipmentForDashboard[];
  purchaseDrafts: PurchaseDraftForDashboard[];
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

  return {
    skuActiveCount: source.skuActiveCount,
    healthRedCount: source.healthRedCount,
    healthYellowCount: source.healthYellowCount,
    belowRopCount: source.belowRopCount,
    pendingSuggestions: source.pendingSuggestions,
    delayedShipments: source.shipments.filter((shipment) =>
      isDelayedShipment(shipment, today),
    ).length,
    delayedDraftsEtaAvailable,
    stockoutRateApprox:
      source.skuActiveCount > 0 ? source.healthRedCount / source.skuActiveCount : 0,
    calculatedAt: today.toISOString(),
  };
}

type HealthCountRow = {
  healthRedCount: number;
  healthYellowCount: number;
};

function firstCount(rows: Array<{ count: number }>): number {
  return Number(rows[0]?.count ?? 0);
}

export async function getPlanningDashboard(today: Date = new Date()): Promise<PlanningDashboard> {
  const [
    activeSkuRows,
    healthResult,
    belowRopRows,
    pendingSuggestionRows,
    shipmentRows,
    draftRows,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(skus)
      .where(eq(skus.isActive, true)),
    db.execute(sql`
      WITH latest_health AS (
        SELECT DISTINCT ON (h.sku_id, h.warehouse_code)
          h.health_status
        FROM ${inventoryHealthSnapshots} h
        INNER JOIN ${skus} s ON s.id = h.sku_id
        WHERE s.is_active = true
        ORDER BY h.sku_id, h.warehouse_code, h.computed_at DESC, h.id DESC
      )
      SELECT
        count(*) FILTER (WHERE health_status = 'red')::int AS "healthRedCount",
        count(*) FILTER (WHERE health_status = 'yellow')::int AS "healthYellowCount"
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

  const healthRows = Array.from(healthResult as unknown as HealthCountRow[]);
  const health = healthRows[0];
  return aggregatePlanningDashboard(
    {
      skuActiveCount: firstCount(activeSkuRows),
      healthRedCount: Number(health?.healthRedCount ?? 0),
      healthYellowCount: Number(health?.healthYellowCount ?? 0),
      belowRopCount: firstCount(belowRopRows),
      pendingSuggestions: firstCount(pendingSuggestionRows),
      shipments: shipmentRows.map((shipment) => ({
        status: shipment.status,
        etaAvailable: shipment.etaAvailable,
        milestones: milestonesByShipment.get(shipment.id) ?? [],
      })),
      purchaseDrafts: draftRows,
    },
    today,
  );
}
