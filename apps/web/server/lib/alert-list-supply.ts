import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, inventorySupplyLots, reorderSuggestions, skus } from '@scm/db';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';

export type AlertListSupply = {
  localQty: number;
  overseasQty: number;
  inTransitQty: number;
  /** 待处理补货建议量；没有建议时用规划时间轴缺口 */
  futureNeedQty: number | null;
  projectedStockoutDate: string | null;
};

type PoolQtys = {
  local: number;
  overseas: number;
  inTransit: number;
};

const EMPTY_POOLS: PoolQtys = { local: 0, overseas: 0, inTransit: 0 };

export function alertSupplyKey(skuId: string, warehouseCode: string | null | undefined) {
  return `${skuId}::${warehouseCode ?? ''}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return asRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseQtyText(value: string | undefined): number | null {
  if (value == null || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function readIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.round(Number(value));
  }
  return null;
}

export function readTimelineSuggestedQty(metrics: unknown): number | null {
  return readFiniteNumber(asRecord(metrics)?.timelineSuggestedQty);
}

export function readTimelineStockoutDate(metrics: unknown): string | null {
  const value = asRecord(metrics)?.timelineStockoutDate;
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** 没有开放批次时，用健康快照里的可售 / 在途 / 在产回退。 */
export function readSnapshotPools(metrics: unknown): PoolQtys | null {
  const position = asRecord(asRecord(metrics)?.inventoryPosition);
  if (!position) return null;
  const available = readFiniteNumber(position.qtyAvailable);
  const transit = readFiniteNumber(position.qtyInTransit);
  const production = readFiniteNumber(position.qtyInProduction);
  const confirmed = readFiniteNumber(position.qtyConfirmedOpen);
  if (available == null && transit == null && production == null && confirmed == null) {
    return null;
  }
  return {
    overseas: available ?? 0,
    inTransit: transit ?? 0,
    local: (production ?? 0) + (confirmed ?? 0),
  };
}

/** 飞书周转合计：供应商订单 / 海外仓在库 / 调拨在途，以及采购周期内预测需求。 */
export function readTurnoverListSupply(snapshot: Record<string, string> | null): {
  pools: PoolQtys | null;
  futureNeedQty: number | null;
  projectedStockoutDate: string | null;
} {
  if (!snapshot || !Object.keys(snapshot).length) {
    return { pools: null, futureNeedQty: null, projectedStockoutDate: null };
  }
  const local = parseQtyText(snapshot['供应商订单']);
  const overseas = parseQtyText(snapshot['海外仓在库'] ?? snapshot['海外仓库存_合计']);
  const inTransit = parseQtyText(snapshot['调拨在途合计'] ?? snapshot['调拨在途_合计']);
  const pools =
    local == null && overseas == null && inTransit == null
      ? null
      : {
          local: local ?? 0,
          overseas: overseas ?? 0,
          inTransit: inTransit ?? 0,
        };
  const daily = parseQtyText(snapshot['本月预测日均销量']);
  const leadDays = parseQtyText(snapshot['采购周期']);
  const futureNeedQty =
    daily != null && leadDays != null && leadDays > 0 ? Math.round(daily * leadDays) : null;
  return {
    pools,
    futureNeedQty,
    projectedStockoutDate: readIsoDate(
      snapshot['预计海外仓断货时间'] ?? snapshot['预计海外断货时间'],
    ),
  };
}

export function resolveAlertListSupply(input: {
  alertStockoutDate?: string | null;
  hasOpenLots: boolean;
  lotPools: PoolQtys;
  suggestionQty: number | null;
  metrics: unknown;
  turnover?: Record<string, string> | null;
  avgDaily?: number | null;
  totalLeadDays?: number | null;
}): AlertListSupply {
  const turnover = readTurnoverListSupply(input.turnover ?? null);
  const snapshotPools = readSnapshotPools(input.metrics);
  const snapshotHasQty =
    snapshotPools != null &&
    (snapshotPools.local > 0 || snapshotPools.overseas > 0 || snapshotPools.inTransit > 0);
  const pools = input.hasOpenLots
    ? input.lotPools
    : (turnover.pools ?? (snapshotHasQty ? snapshotPools : null) ?? snapshotPools ?? EMPTY_POOLS);
  const leadDemand =
    input.avgDaily != null &&
    input.avgDaily > 0 &&
    input.totalLeadDays != null &&
    input.totalLeadDays > 0
      ? Math.round(input.avgDaily * input.totalLeadDays)
      : null;
  const alertDate = input.alertStockoutDate?.slice(0, 10);
  const stockoutFromAlert =
    alertDate && /^\d{4}-\d{2}-\d{2}$/.test(alertDate) ? alertDate : null;
  return {
    localQty: pools.local,
    overseasQty: pools.overseas,
    inTransitQty: pools.inTransit,
    futureNeedQty:
      input.suggestionQty ??
      readTimelineSuggestedQty(input.metrics) ??
      turnover.futureNeedQty ??
      leadDemand,
    projectedStockoutDate:
      stockoutFromAlert ??
      readTimelineStockoutDate(input.metrics) ??
      turnover.projectedStockoutDate,
  };
}

type SupplyRow = {
  skuId: string;
  warehouseCode: string | null;
  projectedStockoutDate: string | null;
};

type LotSumRow = {
  skuId: string;
  warehouseCode: string;
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
};

type SnapshotRow = {
  skuId: string;
  warehouseCode: string;
  metrics: unknown;
  avgDaily: number | string | null;
  totalLeadDays: number | null;
};

export async function loadAlertListSupply(rows: SupplyRow[]): Promise<Map<string, AlertListSupply>> {
  const result = new Map<string, AlertListSupply>();
  if (!rows.length) return result;

  const skuIds = [...new Set(rows.map((row) => row.skuId))];
  const [lotRows, suggestionRows, snapshotResult, skuRows] = await Promise.all([
    db
      .select({
        skuId: inventorySupplyLots.skuId,
        warehouseCode: inventorySupplyLots.warehouseCode,
        pool: inventorySupplyLots.pool,
        qty: sql<number>`coalesce(sum(${inventorySupplyLots.qty}), 0)::int`,
      })
      .from(inventorySupplyLots)
      .where(
        and(inArray(inventorySupplyLots.skuId, skuIds), eq(inventorySupplyLots.status, 'open')),
      )
      .groupBy(
        inventorySupplyLots.skuId,
        inventorySupplyLots.warehouseCode,
        inventorySupplyLots.pool,
      ),
    db
      .select({
        skuId: reorderSuggestions.skuId,
        warehouseCode: reorderSuggestions.warehouseCode,
        suggestedQty: reorderSuggestions.suggestedQty,
      })
      .from(reorderSuggestions)
      .where(
        and(
          inArray(reorderSuggestions.skuId, skuIds),
          eq(reorderSuggestions.status, 'pending'),
          isNull(reorderSuggestions.supersededAt),
        ),
      )
      .orderBy(desc(reorderSuggestions.generatedAt)),
    db.execute(sql`
      SELECT DISTINCT ON (sku_id, warehouse_code)
        sku_id AS "skuId",
        warehouse_code AS "warehouseCode",
        metrics,
        avg_daily AS "avgDaily",
        total_lead_days AS "totalLeadDays"
      FROM inventory_health_snapshots
      WHERE sku_id IN (${sql.join(
        skuIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      ORDER BY sku_id, warehouse_code, computed_at DESC
    `),
    db
      .select({ id: skus.id, encodingMeta: skus.encodingMeta })
      .from(skus)
      .where(inArray(skus.id, skuIds)),
  ]);

  const lotsByKey = new Map<string, PoolQtys>();
  const lotSeen = new Set<string>();
  for (const row of lotRows as LotSumRow[]) {
    const key = alertSupplyKey(row.skuId, row.warehouseCode);
    lotSeen.add(key);
    const pools = lotsByKey.get(key) ?? { ...EMPTY_POOLS };
    if (row.pool === 'local') pools.local += Number(row.qty) || 0;
    if (row.pool === 'overseas') pools.overseas += Number(row.qty) || 0;
    if (row.pool === 'in_transit') pools.inTransit += Number(row.qty) || 0;
    lotsByKey.set(key, pools);
  }

  const suggestionByKey = new Map<string, number>();
  for (const row of suggestionRows) {
    if (!row.warehouseCode) continue;
    const key = alertSupplyKey(row.skuId, row.warehouseCode);
    if (!suggestionByKey.has(key)) suggestionByKey.set(key, row.suggestedQty);
  }

  const metricsByKey = new Map<string, SnapshotRow>();
  for (const row of Array.from(snapshotResult as unknown as SnapshotRow[])) {
    metricsByKey.set(alertSupplyKey(row.skuId, row.warehouseCode), row);
  }

  const turnoverBySku = new Map<string, Record<string, string>>();
  for (const row of skuRows) {
    turnoverBySku.set(row.id, readTurnoverSnapshot(row.encodingMeta));
  }

  for (const row of rows) {
    const key = alertSupplyKey(row.skuId, row.warehouseCode);
    const snapshot = metricsByKey.get(key);
    const avgDaily = snapshot?.avgDaily == null ? null : Number(snapshot.avgDaily);
    result.set(
      key,
      resolveAlertListSupply({
        alertStockoutDate: row.projectedStockoutDate,
        hasOpenLots: lotSeen.has(key),
        lotPools: lotsByKey.get(key) ?? EMPTY_POOLS,
        suggestionQty: suggestionByKey.get(key) ?? null,
        metrics: snapshot?.metrics ?? null,
        turnover: turnoverBySku.get(row.skuId) ?? null,
        avgDaily: avgDaily != null && Number.isFinite(avgDaily) ? avgDaily : null,
        totalLeadDays: snapshot?.totalLeadDays ?? null,
      }),
    );
  }
  return result;
}
