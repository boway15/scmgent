import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, inventorySupplyLots, reorderSuggestions, skus } from '@scm/db';
import {
  forecastDailyOnDate,
  publishedForecastDailyRecord,
  publishedNetworkAvgDaily,
} from './alert-network-coverage.js';
import { DEMAND_PLAN_WAREHOUSE_ALL } from './demand-plan-config.js';
import {
  loadPlanningDemandDepsForSkus,
  loadPlanningDemandForSkuWarehouse,
} from './demand-plan-load.js';
import { networkConsensusForecastRecord } from './demand-plan-resolve.js';
import {
  addInTransitWindow,
  classifyInTransitArrival,
  type InTransitWindowQty,
} from './alert-horizon-demand.js';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { loadMergedPublishedForecastBySkuIds } from './forecast-published-resolve.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';

export type AlertListSupply = {
  /** 本仓：该目的仓开放批次；没有批次时用健康快照头寸，仍没有则为 0 */
  localQty: number;
  overseasQty: number;
  inTransitQty: number;
  /** 本仓未来需求：待处理建议量，否则时间轴建议量，否则本仓日均 × 交期 */
  futureNeedQty: number | null;
  /** 本仓预计缺货：预警断货日，否则时间轴断货日 */
  projectedStockoutDate: string | null;
  /** 全网合计：飞书周转，同一 SKU 各仓相同；没有周转快照则为 null */
  networkLocalQty: number | null;
  networkOverseasQty: number | null;
  networkInTransitQty: number | null;
  networkFutureNeedQty: number | null;
  /** 业务日所在月/周的生效日均：已发布预测优先，否则周转「本月预测日均」 */
  networkAvgDaily: number | null;
  /** 已发布预测曲线（年月或 ISO 周 → 日均）。可售天数按这条曲线逐日扣减。 */
  networkForecastDaily: Record<string, number> | null;
  /** 库存周转「7/14/30天销量」，SKU 全网口径 */
  turnoverSales7d: number | null;
  turnoverSales14d: number | null;
  turnoverSales30d: number | null;
  /** 本仓健康快照日均，用于在途件数折算可售天数 */
  warehouseAvgDaily: number | null;
  /** 本仓采购交期（生产 + 海运 + 入仓），用于建议下单日 */
  totalLeadDays: number | null;
  /** 本仓在途：无上架日或日期为估算 */
  inTransitUndatedQty: number;
  inTransitWithin45: number;
  inTransitWithin60: number;
  /** SKU 全网在途窗口，各仓相同 */
  networkInTransitWithin45: number;
  networkInTransitWithin60: number;
  networkInTransitUndatedQty: number;
  /** 已发布预测分层。已采纳需求计划时为空，避免在共识需求上再乘远月缓冲。 */
  forecastProfileClass: string | null;
  forecastP90Daily: Record<string, number> | null;
};

type PoolQtys = {
  local: number;
  overseas: number;
  inTransit: number;
};

const EMPTY_POOLS: PoolQtys = { local: 0, overseas: 0, inTransit: 0 };

function p90Record(map: Map<string, number> | undefined): Record<string, number> | null {
  if (!map?.size) return null;
  return Object.fromEntries(map);
}

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

/** 没有开放批次时，本仓回退到健康快照里的可售 / 在途 / 在产。全网合计不走这里。 */
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
  avgDaily: number | null;
  salesQty7d: number | null;
  salesQty14d: number | null;
  salesQty30d: number | null;
} {
  if (!snapshot || !Object.keys(snapshot).length) {
    return {
      pools: null,
      futureNeedQty: null,
      projectedStockoutDate: null,
      avgDaily: null,
      salesQty7d: null,
      salesQty14d: null,
      salesQty30d: null,
    };
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
  const dailyRaw = snapshot['本月预测日均销量'];
  const dailyParsed = dailyRaw == null || !dailyRaw.trim() ? null : Number(dailyRaw.replace(/,/g, ''));
  const avgDaily = dailyParsed != null && Number.isFinite(dailyParsed) ? dailyParsed : null;
  const daily = avgDaily == null ? null : Math.round(avgDaily);
  const leadDays = parseQtyText(snapshot['采购周期']);
  const futureNeedQty =
    daily != null && leadDays != null && leadDays > 0 ? Math.round(daily * leadDays) : null;
  return {
    pools,
    futureNeedQty,
    projectedStockoutDate: readIsoDate(
      snapshot['预计海外仓断货时间'] ?? snapshot['预计海外断货时间'],
    ),
    avgDaily,
    salesQty7d: parseQtyText(snapshot['7天销量']),
    salesQty14d: parseQtyText(snapshot['14天销量']),
    salesQty30d: parseQtyText(snapshot['30天销量']),
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
  publishedNetworkAvgDaily?: number | null;
  publishedForecastDaily?: Record<string, number> | null;
  forecastProfileClass?: string | null;
  forecastP90Daily?: Record<string, number> | null;
  inTransitWindow?: InTransitWindowQty;
  networkInTransitWindow?: InTransitWindowQty;
}): AlertListSupply {
  const turnover = readTurnoverListSupply(input.turnover ?? null);
  const snapshotPools = readSnapshotPools(input.metrics);
  const warehousePools = input.hasOpenLots ? input.lotPools : (snapshotPools ?? EMPTY_POOLS);
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
  const network = turnover.pools;
  const transit = input.inTransitWindow ?? { within45: 0, within60: 0, undated: 0 };
  const networkTransit = input.networkInTransitWindow ?? { within45: 0, within60: 0, undated: 0 };
  return {
    localQty: warehousePools.local,
    overseasQty: warehousePools.overseas,
    inTransitQty: warehousePools.inTransit,
    futureNeedQty:
      input.suggestionQty ?? readTimelineSuggestedQty(input.metrics) ?? leadDemand,
    projectedStockoutDate: stockoutFromAlert ?? readTimelineStockoutDate(input.metrics),
    networkLocalQty: network?.local ?? null,
    networkOverseasQty: network?.overseas ?? null,
    networkInTransitQty: network?.inTransit ?? null,
    networkFutureNeedQty: turnover.futureNeedQty,
    networkAvgDaily: input.publishedNetworkAvgDaily ?? turnover.avgDaily ?? null,
    networkForecastDaily: input.publishedForecastDaily ?? null,
    turnoverSales7d: turnover.salesQty7d,
    turnoverSales14d: turnover.salesQty14d,
    turnoverSales30d: turnover.salesQty30d,
    warehouseAvgDaily: input.avgDaily != null && Number.isFinite(input.avgDaily) ? input.avgDaily : null,
    totalLeadDays:
      input.totalLeadDays != null && Number.isFinite(input.totalLeadDays) ? input.totalLeadDays : null,
    inTransitUndatedQty: transit.undated,
    inTransitWithin45: transit.within45,
    inTransitWithin60: transit.within60,
    networkInTransitWithin45: networkTransit.within45,
    networkInTransitWithin60: networkTransit.within60,
    networkInTransitUndatedQty: networkTransit.undated,
    forecastProfileClass: input.forecastProfileClass ?? null,
    forecastP90Daily: input.forecastP90Daily ?? null,
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

function lotDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function loadAlertListSupply(rows: SupplyRow[]): Promise<Map<string, AlertListSupply>> {
  const result = new Map<string, AlertListSupply>();
  if (!rows.length) return result;

  const skuIds = [...new Set(rows.map((row) => row.skuId))];
  const businessDate = getShanghaiBusinessDate();
  const [lotRows, transitRows, suggestionRows, snapshotResult, skuRows, forecastBySku] = await Promise.all([
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
        skuId: inventorySupplyLots.skuId,
        warehouseCode: inventorySupplyLots.warehouseCode,
        qty: inventorySupplyLots.qty,
        availableAt: inventorySupplyLots.availableAt,
        etaEstimated: inventorySupplyLots.etaEstimated,
        dateUnknown: inventorySupplyLots.dateUnknown,
      })
      .from(inventorySupplyLots)
      .where(
        and(
          inArray(inventorySupplyLots.skuId, skuIds),
          eq(inventorySupplyLots.status, 'open'),
          eq(inventorySupplyLots.pool, 'in_transit'),
        ),
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
    loadMergedPublishedForecastBySkuIds(skuIds),
  ]);
  const planningBundle = await loadPlanningDemandDepsForSkus(skuIds);
  const consensusBySku = new Map<
    string,
    { record: Record<string, number> | null; fromPlan: boolean }
  >();
  for (const skuId of skuIds) {
    const published = forecastBySku.get(skuId);
    const publishedRecord = publishedForecastDailyRecord(published);
    const planning = await loadPlanningDemandForSkuWarehouse(
      {
        skuId,
        warehouseCode: DEMAND_PLAN_WAREHOUSE_ALL,
        championForecastMap: published?.map ?? new Map(),
      },
      planningBundle.deps,
    );
    const record = networkConsensusForecastRecord({
      source: planning.source,
      demandMap: planning.demandMap,
      published: publishedRecord,
    });
    consensusBySku.set(skuId, {
      record,
      fromPlan: planning.source === 'demand_plan' && record !== publishedRecord,
    });
  }

  const emptyWindow: InTransitWindowQty = { within45: 0, within60: 0, undated: 0 };
  const transitByKey = new Map<string, InTransitWindowQty>();
  const transitBySku = new Map<string, InTransitWindowQty>();
  for (const row of transitRows) {
    const slice = classifyInTransitArrival({
      today: businessDate,
        availableAt: lotDate(row.availableAt),
      etaEstimated: row.etaEstimated,
      dateUnknown: row.dateUnknown,
      qty: Number(row.qty) || 0,
    });
    const key = alertSupplyKey(row.skuId, row.warehouseCode);
    transitByKey.set(key, addInTransitWindow(transitByKey.get(key) ?? emptyWindow, slice));
    transitBySku.set(row.skuId, addInTransitWindow(transitBySku.get(row.skuId) ?? emptyWindow, slice));
  }

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
    const leadDays = snapshot?.totalLeadDays == null ? null : Number(snapshot.totalLeadDays);
    const published = forecastBySku.get(row.skuId);
    const consensus = consensusBySku.get(row.skuId);
    const publishedForecastDaily = consensus?.record ?? publishedForecastDailyRecord(published);
    const planDaily =
      consensus?.fromPlan && consensus.record
        ? forecastDailyOnDate(new Map(Object.entries(consensus.record)), businessDate)
        : 0;
    const publishedDaily =
      planDaily > 0 ? planDaily : publishedNetworkAvgDaily(published, businessDate);
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
        totalLeadDays: leadDays != null && Number.isFinite(leadDays) ? leadDays : null,
        publishedNetworkAvgDaily: publishedDaily,
        publishedForecastDaily,
        forecastProfileClass: consensus?.fromPlan
          ? null
          : (published?.profileClass ?? null),
        forecastP90Daily: consensus?.fromPlan ? null : p90Record(published?.p90Map),
        inTransitWindow: transitByKey.get(key),
        networkInTransitWindow: transitBySku.get(row.skuId),
      }),
    );
  }
  return result;
}
