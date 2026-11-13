/**
 * 存销分析 Cube 重建与查询服务。
 *
 * 主库存口径与 resolveInventoryPosition 同构（snapshot_only）：
 * - 本仓有原生 inventory_records 量 → native_warehouse
 * - 否则按周转销售占比把 OVERSEAS 拆到物理仓 → sales_share
 * - 无占比且仍有海外库存 → 单行 OVERSEAS + unallocated
 *
 * 销量按 SKU 7/14/30 日窗口聚合后按占比分摊到仓。
 */
import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, sql, ilike, or, count, countDistinct } from 'drizzle-orm';
import {
  db,
  inventoryRecords,
  inventorySalesCubeRows,
  inventorySalesCubeRuns,
  inventorySnapshotRuns,
  salesHistory,
  skus,
  warehouses,
  type InventorySalesCubeMeta,
} from '@scm/db';
import {
  allocateByShare,
  parseSharesFromSnapshot,
  type ShareParseResult,
} from './inventory-share-allocation.js';
import {
  UNALLOCATED_TRANSIT_WAREHOUSE,
  IN_PRODUCTION_WAREHOUSE,
} from './inventory-constants.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { parseForecastSkuQuery } from './forecast-sku-query.js';
import {
  resolveInventoryPositionFromSnapshot,
  PLANNING_INVENTORY_DEDUPE_MODE,
  type InventoryPositionBreakdown,
} from './inventory-position.js';
import {
  loadLeadTimeCaches,
} from './inventory-health-service.js';
import {
  resolveLeadTimeFromCaches,
  type LeadTimeResolveCaches,
} from './lead-time-resolver.js';
import {
  allocateSalesWindows,
  buildRiskTags,
  calcCoverDays,
  calcSellThrough30d,
  COVER_BAND_LABELS,
  COVER_BAND_VERSION,
  isCoverBandKey,
} from './inventory-sales-metrics.js';
import { isAccessorySku } from './sku-encoding.js';
import type { ProductScope } from './planning-accessory-filter.js';
import { REPLENISHMENT_DEFAULTS } from '../rules/replenishment/params.js';
import {
  DEFAULT_PRODUCTION_LEAD_DAYS,
  DEFAULT_INBOUND_BUFFER_DAYS,
  resolveShippingLeadDays,
  calcTotalLeadTime,
} from './replenishment-coverage.js';

/**
 * 兜底全链路提前期：与 lead-time-resolver / inventory-health 在无 profile 时的回退口径一致。
 * productionDays=DEFAULT_PRODUCTION_LEAD_DAYS(50) + shippingDays=resolveShippingLeadDays('US-EAST')(60)
 * + inboundBufferDays=DEFAULT_INBOUND_BUFFER_DAYS(7) = 117 天。
 */
const DEFAULT_TOTAL_LEAD_DAYS = calcTotalLeadTime({
  productionDays: DEFAULT_PRODUCTION_LEAD_DAYS,
  shippingDays: resolveShippingLeadDays('US-EAST'),
  inboundBufferDays: DEFAULT_INBOUND_BUFFER_DAYS,
}).totalLeadDays;

const SKU_IN_CHUNK = 2000;
const ROW_INSERT_CHUNK = 1000;
/** 与销售分析 cube 对齐：running 超 10 分钟视为僵尸，自动标 failed。 */
const STALE_RUNNING_MS = 10 * 60 * 1000;
/** 仅保留最近 N 次 ready/failed 历史。 */
const RUN_KEEP = 10;

// ---------------------------------------------------------------------------
// 纯函数切片（供单测）
// ---------------------------------------------------------------------------

export type BuildCubeRowsForSkuInput = {
  skuId: string;
  skuCode: string;
  productScope: ProductScope;
  category: string | null;
  lifecycle: string | null;
  salesCountry: string | null;
  share: ShareParseResult;
  overseasAvailable: number;
  overseasInTransit: number;
  nativeByWarehouse: Map<
    string,
    { qtyAvailable: number; qtyInTransit: number; qtyInProduction?: number }
  >;
  sales7d: number;
  sales14d: number;
  sales30d: number;
  totalLeadDaysByWarehouse: Map<string, number>;
  defaultTotalLeadDays: number;
};

export type CubeRowForSku = {
  warehouseCode: string;
  productScope: ProductScope;
  category: string | null;
  lifecycle: string | null;
  salesCountry: string | null;
  qtyAvailable: number;
  qtyInTransit: number;
  effectiveQty: number;
  shareMethod: 'sales_share' | 'unallocated' | 'native_warehouse';
  shareWeight: number | null;
  sales7d: number | null;
  sales14d: number | null;
  sales30d: number | null;
  avgDaily30d: number | null;
  coverDays: number | null;
  sellThrough30d: number | null;
  primaryRisk: string | null;
  riskTags: string[];
};

/**
 * 单 SKU 行构建：对每个目标仓算 effective、分摊销量、算 cover/sell-through、风险标签。
 * peerCoverDays 在二次打标签时由调用方提供（见 buildCubeRowsForSkuWithPeers）。
 */
export function buildCubeRowsForSku(input: BuildCubeRowsForSkuInput): CubeRowForSku[] {
  const rows: CubeRowForSku[] = [];

  const salesWindows = allocateSalesWindows({
    sales7d: input.sales7d,
    sales14d: input.sales14d,
    sales30d: input.sales30d,
    share: input.share,
  });

  const hasSales = input.sales30d > 0 || input.sales14d > 0 || input.sales7d > 0;
  const pushRow = (
    warehouseCode: string,
    position: InventoryPositionBreakdown,
    shareMethod: CubeRowForSku['shareMethod'],
    shareWeight: number | null,
  ) => {
    const allocated = hasSales ? salesWindows.get(warehouseCode) : undefined;
    const sales7d = allocated?.sales7d ?? null;
    const sales14d = allocated?.sales14d ?? null;
    const sales30d = allocated?.sales30d ?? null;
    const avgDaily30d = sales30d != null ? sales30d / 30 : null;
    const coverDays = calcCoverDays(position.effectiveQty, avgDaily30d ?? 0);
    const sellThrough30d =
      sales30d != null ? calcSellThrough30d(sales30d, position.effectiveQty) : null;
    const totalLeadDays =
      input.totalLeadDaysByWarehouse.get(warehouseCode) ?? input.defaultTotalLeadDays;
    const { tags, primaryRisk } = buildRiskTags({
      shareMethod,
      effectiveQty: position.effectiveQty,
      coverDays,
      avgDaily30d: avgDaily30d ?? 0,
      lifecycle: input.lifecycle,
      totalLeadDays,
      peerCoverDays: [], // 二次打标签时填入
      overstockThresholdDays: REPLENISHMENT_DEFAULTS.overstockThresholdDays,
    });
    rows.push({
      warehouseCode,
      productScope: input.productScope,
      category: input.category,
      lifecycle: input.lifecycle,
      salesCountry: input.salesCountry,
      qtyAvailable: position.qtyAvailable,
      qtyInTransit: position.qtyInTransit,
      effectiveQty: position.effectiveQty,
      shareMethod,
      shareWeight,
      sales7d,
      sales14d,
      sales30d,
      avgDaily30d,
      coverDays,
      sellThrough30d,
      primaryRisk,
      riskTags: tags,
    });
  };

  if (input.share.method === 'sales_share' && input.share.weights.length > 0) {
    for (const w of input.share.weights) {
      const native = input.nativeByWarehouse.get(w.warehouse);
      const position = native
        ? resolveInventoryPositionFromSnapshot({
            warehouseCode: w.warehouse,
            qtyAvailable: native.qtyAvailable,
            qtyInTransit: native.qtyInTransit,
            qtyInProduction: native.qtyInProduction,
            dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
          })
        : resolveInventoryPositionFromSnapshot({
            warehouseCode: w.warehouse,
            qtyAvailable: allocateByShare(input.overseasAvailable, input.share).get(w.warehouse) ?? 0,
            qtyInTransit: allocateByShare(input.overseasInTransit, input.share).get(w.warehouse) ?? 0,
            dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
          });
      const method: CubeRowForSku['shareMethod'] = native ? 'native_warehouse' : 'sales_share';
      pushRow(w.warehouse, position, method, w.weight);
    }
  } else if (input.overseasAvailable > 0 || input.overseasInTransit > 0) {
    // 无占比 + 仍有海外库存 → 单行 OVERSEAS + unallocated
    const position = resolveInventoryPositionFromSnapshot({
      warehouseCode: UNALLOCATED_TRANSIT_WAREHOUSE,
      qtyAvailable: input.overseasAvailable,
      qtyInTransit: input.overseasInTransit,
      dedupeMode: PLANNING_INVENTORY_DEDUPE_MODE,
    });
    pushRow(UNALLOCATED_TRANSIT_WAREHOUSE, position, 'unallocated', null);
  }

  // 二次打标签：用同 SKU 各仓 coverDays 重算 imbalance。
  relabelRiskTagsForSku(rows, {
    totalLeadDaysByWarehouse: input.totalLeadDaysByWarehouse,
    defaultTotalLeadDays: input.defaultTotalLeadDays,
  });
  return rows;
}

/** 二次打标签：用同 SKU 各仓 coverDays 重新算 imbalance。 */
export function relabelRiskTagsForSku(
  rows: CubeRowForSku[],
  input: { totalLeadDaysByWarehouse: Map<string, number>; defaultTotalLeadDays: number },
): void {
  const peerCoverDays = rows.map((r) => r.coverDays);
  for (const row of rows) {
    const totalLeadDays =
      input.totalLeadDaysByWarehouse.get(row.warehouseCode) ?? input.defaultTotalLeadDays;
    const { tags, primaryRisk } = buildRiskTags({
      shareMethod: row.shareMethod,
      effectiveQty: row.effectiveQty,
      coverDays: row.coverDays,
      avgDaily30d: row.avgDaily30d ?? 0,
      lifecycle: row.lifecycle,
      totalLeadDays,
      peerCoverDays: peerCoverDays.filter((d) => d !== row.coverDays),
      overstockThresholdDays: REPLENISHMENT_DEFAULTS.overstockThresholdDays,
    });
    row.riskTags = tags;
    row.primaryRisk = primaryRisk;
  }
}

// ---------------------------------------------------------------------------
// 并发保护纯逻辑
// ---------------------------------------------------------------------------

export function assertNoRunningCube(params: {
  running: Array<{ id: string; startedAt: Date | null }>;
  force: boolean;
}): void {
  if (!params.force && params.running.length > 0) {
    throw new Error('inventory_sales_cube rebuild already running');
  }
}

// ---------------------------------------------------------------------------
// DB 辅助加载
// ---------------------------------------------------------------------------

type SkuMetaRow = {
  id: string;
  code: string;
  encodingMeta: unknown;
  category: string | null;
  lifecycle: string | null;
  salesCountry: string | null;
  skuKind: string | null;
  merchantCode: string | null;
  leadTimeDays: number | null;
};

type LatestInvRow = {
  skuId: string;
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
};

async function loadActiveSkuMetas(): Promise<SkuMetaRow[]> {
  return db
    .select({
      id: skus.id,
      code: skus.code,
      encodingMeta: skus.encodingMeta,
      category: skus.category,
      lifecycle: skus.lifecycle,
      salesCountry: skus.salesCountry,
      skuKind: skus.skuKind,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
    })
    .from(skus)
    .where(eq(skus.isActive, true));
}

/** 批量加载 SKU 最新 inventory_records（按 sku_id, warehouse 去重，取最新 recorded_date）。 */
async function loadLatestInventoryRecordsBySkuIds(
  skuIds: string[],
): Promise<Map<string, Map<string, LatestInvRow>>> {
  const result = new Map<string, Map<string, LatestInvRow>>();
  if (!skuIds.length) return result;

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const queryResult = await db.execute(sql`
      WITH latest_inv AS (
        SELECT DISTINCT ON (sku_id, warehouse)
          sku_id,
          warehouse,
          qty_available,
          qty_in_transit,
          qty_in_production,
          COALESCE(qty_reserved, 0) AS qty_reserved
        FROM inventory_records
        WHERE sku_id IN (${sql.join(
          chunk.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        ORDER BY sku_id, warehouse, recorded_date DESC, created_at DESC
      )
      SELECT
        sku_id AS "skuId",
        warehouse AS "warehouseCode",
        qty_available::int AS "qtyAvailable",
        qty_in_transit::int AS "qtyInTransit",
        qty_in_production::int AS "qtyInProduction",
        qty_reserved::int AS "qtyReserved"
      FROM latest_inv
    `);

    for (const row of Array.from(queryResult as unknown as LatestInvRow[])) {
      let byWh = result.get(row.skuId);
      if (!byWh) {
        byWh = new Map();
        result.set(row.skuId, byWh);
      }
      byWh.set(row.warehouseCode, row);
    }
  }
  return result;
}

/**
 * 销量入湖延迟：当天及昨天通常未同步。
 * 7/14/30 窗口截止日 = 上海业务日 − lagDays（默认 2）。
 */
export const INVENTORY_SALES_CUBE_SALES_LAG_DAYS = 2;

/** 由 Cube 业务日推导销量窗口截止日（含同步延迟）。 */
export function resolveSalesWindowAsOf(
  businessDate: string,
  lagDays: number = INVENTORY_SALES_CUBE_SALES_LAG_DAYS,
): string {
  return addDaysIso(businessDate, -lagDays);
}

/** 批量加载 SKU 7/14/30 日窗口销量（按 sku_id 聚合，闭区间）。 */
async function loadSalesWindowsBySkuIds(params: {
  skuIds: string[];
  /** 销量窗口截止日（已含同步延迟，不是原始业务日） */
  salesAsOf: string;
}): Promise<Map<string, { sales7d: number; sales14d: number; sales30d: number }>> {
  const result = new Map<string, { sales7d: number; sales14d: number; sales30d: number }>();
  if (!params.skuIds.length) return result;

  const end = params.salesAsOf;
  const start30 = addDaysIso(end, -29); // 30 天闭区间 [start30, end]
  const start14 = addDaysIso(end, -13);
  const start7 = addDaysIso(end, -6);

  for (let offset = 0; offset < params.skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = params.skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const queryResult = await db.execute(sql`
      SELECT
        sku_id AS "skuId",
        COALESCE(SUM(qty_sold) FILTER (WHERE sale_date BETWEEN ${start7} AND ${end}), 0)::int AS "sales7d",
        COALESCE(SUM(qty_sold) FILTER (WHERE sale_date BETWEEN ${start14} AND ${end}), 0)::int AS "sales14d",
        COALESCE(SUM(qty_sold) FILTER (WHERE sale_date BETWEEN ${start30} AND ${end}), 0)::int AS "sales30d"
      FROM sales_history
      WHERE sku_id IN (${sql.join(
        chunk.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND sale_date BETWEEN ${start30} AND ${end}
      GROUP BY sku_id
    `);

    for (const row of Array.from(
      queryResult as unknown as Array<{
        skuId: string;
        sales7d: number;
        sales14d: number;
        sales30d: number;
      }>,
    )) {
      result.set(row.skuId, {
        sales7d: row.sales7d,
        sales14d: row.sales14d,
        sales30d: row.sales30d,
      });
    }
  }
  return result;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 当日是否有 published 周转快照。 */
async function findPublishedTurnoverRun(
  snapshotDate: string,
): Promise<{ id: string; snapshotDate: string } | null> {
  const [row] = await db
    .select({ id: inventorySnapshotRuns.id, snapshotDate: inventorySnapshotRuns.snapshotDate })
    .from(inventorySnapshotRuns)
    .where(
      and(
        eq(inventorySnapshotRuns.snapshotDate, snapshotDate),
        eq(inventorySnapshotRuns.status, 'published'),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

export type RebuildResult = {
  runId: string;
  status: 'ready' | 'failed' | 'skipped';
  rowCount?: number;
  message?: string;
};

export async function clearStaleRunningInventorySalesCubeRuns(
  now: Date = new Date(),
  maxAgeMs: number = STALE_RUNNING_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const updated = await db
    .update(inventorySalesCubeRuns)
    .set({
      status: 'failed',
      errorMessage: `rebuild timed out or process restarted (running > ${Math.round(maxAgeMs / 60000)} min)`,
    })
    .where(
      and(
        eq(inventorySalesCubeRuns.status, 'running'),
        lt(inventorySalesCubeRuns.createdAt, cutoff),
      ),
    )
    .returning({ id: inventorySalesCubeRuns.id });
  return updated.length;
}

export async function rebuildInventorySalesCube(opts?: {
  actorId?: string | null;
  force?: boolean;
}): Promise<RebuildResult> {
  await clearStaleRunningInventorySalesCubeRuns();

  const running = await db
    .select({ id: inventorySalesCubeRuns.id, startedAt: inventorySalesCubeRuns.startedAt })
    .from(inventorySalesCubeRuns)
    .where(eq(inventorySalesCubeRuns.status, 'running'))
    .limit(1);
  assertNoRunningCube({ running, force: opts?.force ?? false });

  const snapshotDate = getShanghaiBusinessDate();
  const startedAt = new Date();

  const [run] = await db
    .insert(inventorySalesCubeRuns)
    .values({
      snapshotDate,
      status: 'running',
      startedAt,
      createdBy: opts?.actorId ?? null,
    })
    .returning({ id: inventorySalesCubeRuns.id });

  if (!run) return { runId: '', status: 'failed', message: 'failed to create run row' };

  try {
    const turnoverRun = await findPublishedTurnoverRun(snapshotDate);
    if (!turnoverRun) {
      // 源周转未发布：标记本 run 为 skipped（保留上一 ready）
      await db
        .update(inventorySalesCubeRuns)
        .set({
          status: 'skipped',
          errorMessage: '源周转未发布',
          finishedAt: new Date(),
        })
        .where(eq(inventorySalesCubeRuns.id, run.id));
      return { runId: run.id, status: 'skipped', message: '源周转未发布' };
    }

    const skuMetas = await loadActiveSkuMetas();
    const skuIds = skuMetas.map((s) => s.id);
    // 历史销量有同步延迟：窗口截至业务日−2，避免把未入湖的当天/昨天算进近 N 日
    const salesAsOf = resolveSalesWindowAsOf(snapshotDate);

    const [invBySku, salesBySku, leadTimeCaches, whRows] = await Promise.all([
      loadLatestInventoryRecordsBySkuIds(skuIds),
      loadSalesWindowsBySkuIds({ skuIds, salesAsOf }),
      loadLeadTimeCaches(skuIds),
      db
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, true)),
    ]);

    const physicalWarehouseCodes = whRows
      .map((w) => w.code)
      .filter((c) => c !== IN_PRODUCTION_WAREHOUSE);

    const allRows: Array<{
      skuId: string;
      skuCode: string;
      qtyDomesticUnshipped: number;
      row: CubeRowForSku;
    }> = [];

    for (const sku of skuMetas) {
      const share = parseSharesFromSnapshot(readTurnoverSnapshot(sku.encodingMeta));
      const nativeByWarehouse = invBySku.get(sku.id) ?? new Map();
      const overseas = nativeByWarehouse.get(UNALLOCATED_TRANSIT_WAREHOUSE);
      const overseasAvailable = overseas?.qtyAvailable ?? 0;
      const overseasInTransit = overseas?.qtyInTransit ?? 0;
      // 国内未发：IN-PRODUCTION 逻辑仓在产量（已下单供应商未发出）；SKU 级，不计入仓有效供给
      const domestic = nativeByWarehouse.get(IN_PRODUCTION_WAREHOUSE);
      const qtyDomesticUnshipped = Math.max(0, domestic?.qtyInProduction ?? 0);
      const sales = salesBySku.get(sku.id) ?? {
        sales7d: 0,
        sales14d: 0,
        sales30d: 0,
      };

      // 为每个物理仓算 totalLeadDays
      const totalLeadDaysByWarehouse = new Map<string, number>();
      for (const wh of physicalWarehouseCodes) {
        const resolved = resolveLeadTimeFromCaches(
          {
            skuId: sku.id,
            merchantCode: sku.merchantCode,
            warehouseCode: wh,
            skuLeadTimeDays: sku.leadTimeDays,
          },
          leadTimeCaches,
        );
        totalLeadDaysByWarehouse.set(wh, resolved.totalLeadDays);
      }

      const productScope: ProductScope = isAccessorySku({
        code: sku.code,
        skuKind: sku.skuKind,
      })
        ? 'accessory'
        : 'goods';

      const rows = buildCubeRowsForSku({
        skuId: sku.id,
        skuCode: sku.code,
        productScope,
        category: sku.category,
        lifecycle: sku.lifecycle,
        salesCountry: sku.salesCountry,
        share,
        overseasAvailable,
        overseasInTransit,
        nativeByWarehouse,
        sales7d: sales.sales7d,
        sales14d: sales.sales14d,
        sales30d: sales.sales30d,
        totalLeadDaysByWarehouse,
        defaultTotalLeadDays: DEFAULT_TOTAL_LEAD_DAYS,
      });

      for (const row of rows) {
        allRows.push({
          skuId: sku.id,
          skuCode: sku.code,
          qtyDomesticUnshipped,
          row,
        });
      }
    }

    // 批量插入 rows
    for (let i = 0; i < allRows.length; i += ROW_INSERT_CHUNK) {
      const chunk = allRows.slice(i, i + ROW_INSERT_CHUNK);
      await db.insert(inventorySalesCubeRows).values(
        chunk.map((r) => ({
          runId: run.id,
          skuId: r.skuId,
          skuCode: r.skuCode,
          warehouseCode: r.row.warehouseCode,
          productScope: r.row.productScope,
          category: r.row.category,
          lifecycle: r.row.lifecycle,
          salesCountry: r.row.salesCountry,
          qtyAvailable: r.row.qtyAvailable,
          qtyInTransit: r.row.qtyInTransit,
          qtyDomesticUnshipped: r.qtyDomesticUnshipped,
          effectiveQty: r.row.effectiveQty,
          shareMethod: r.row.shareMethod,
          shareWeight: r.row.shareWeight,
          sales7d: r.row.sales7d,
          sales14d: r.row.sales14d,
          sales30d: r.row.sales30d,
          avgDaily30d: r.row.avgDaily30d,
          coverDays: r.row.coverDays,
          sellThrough30d: r.row.sellThrough30d,
          primaryRisk: r.row.primaryRisk,
          riskTags: r.row.riskTags,
        })),
      );
    }

    const meta: InventorySalesCubeMeta = {
      warehouses: physicalWarehouseCodes,
      thresholds: {
        overstockThresholdDays: REPLENISHMENT_DEFAULTS.overstockThresholdDays,
        slowMovingDailyMax: REPLENISHMENT_DEFAULTS.slowMovingDailyMax,
        slowMovingMinCoverageDays: REPLENISHMENT_DEFAULTS.slowMovingMinCoverageDays,
        version: '1',
      },
      sourceStats: {
        skuCount: skuMetas.length,
        rowCount: allRows.length,
      },
    };

    await db
      .update(inventorySalesCubeRuns)
      .set({
        status: 'ready',
        sourceTurnoverDate: turnoverRun.snapshotDate,
        sourceSalesAsOf: salesAsOf,
        rowCount: allRows.length,
        meta,
        finishedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(inventorySalesCubeRuns.id, run.id));

    await pruneOldRuns(RUN_KEEP);

    return {
      runId: run.id,
      status: 'ready',
      rowCount: allRows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(inventorySalesCubeRuns)
      .set({
        status: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(inventorySalesCubeRuns.id, run.id));
    return { runId: run.id, status: 'failed', message };
  }
}

async function pruneOldRuns(keep: number): Promise<void> {
  const kept = await db
    .select({ id: inventorySalesCubeRuns.id })
    .from(inventorySalesCubeRuns)
    .orderBy(desc(inventorySalesCubeRuns.createdAt))
    .limit(keep);
  if (!kept.length) return;
  const keepIds = kept.map((r) => r.id);
  await db
    .delete(inventorySalesCubeRuns)
    .where(notInArray(inventorySalesCubeRuns.id, keepIds));
}

// ---------------------------------------------------------------------------
// 查询接口
// ---------------------------------------------------------------------------

export type InventorySalesCubeStatusDto = {
  running: boolean;
  ready: {
    runId: string | null;
    snapshotDate: string | null;
    sourceTurnoverDate: string | null;
    sourceSalesAsOf: string | null;
    rowCount: number | null;
    meta: InventorySalesCubeMeta | null;
    finishedAt: string | null;
  };
  failed: {
    runId: string | null;
    errorMessage: string | null;
    createdAt: string | null;
  } | null;
  skipped: {
    runId: string | null;
    message: string | null;
    createdAt: string | null;
  } | null;
};

export async function getInventorySalesCubeStatus(): Promise<InventorySalesCubeStatusDto> {
  await clearStaleRunningInventorySalesCubeRuns();

  const [[running], [ready], [failed], [skipped]] = await Promise.all([
    db
      .select({ id: inventorySalesCubeRuns.id })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.status, 'running'))
      .limit(1),
    db
      .select({
        id: inventorySalesCubeRuns.id,
        snapshotDate: inventorySalesCubeRuns.snapshotDate,
        sourceTurnoverDate: inventorySalesCubeRuns.sourceTurnoverDate,
        sourceSalesAsOf: inventorySalesCubeRuns.sourceSalesAsOf,
        rowCount: inventorySalesCubeRuns.rowCount,
        meta: inventorySalesCubeRuns.meta,
        finishedAt: inventorySalesCubeRuns.finishedAt,
        createdAt: inventorySalesCubeRuns.createdAt,
      })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.status, 'ready'))
      .orderBy(desc(inventorySalesCubeRuns.createdAt))
      .limit(1),
    db
      .select({
        id: inventorySalesCubeRuns.id,
        errorMessage: inventorySalesCubeRuns.errorMessage,
        createdAt: inventorySalesCubeRuns.createdAt,
      })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.status, 'failed'))
      .orderBy(desc(inventorySalesCubeRuns.createdAt))
      .limit(1),
    db
      .select({
        id: inventorySalesCubeRuns.id,
        errorMessage: inventorySalesCubeRuns.errorMessage,
        createdAt: inventorySalesCubeRuns.createdAt,
      })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.status, 'skipped'))
      .orderBy(desc(inventorySalesCubeRuns.createdAt))
      .limit(1),
  ]);

  // 仅当 failed 比 ready 更新时才暴露
  const showFailed =
    Boolean(failed?.id) &&
    (!ready?.createdAt || (failed!.createdAt != null && failed!.createdAt > ready.createdAt));

  return {
    running: Boolean(running),
    ready: {
      runId: ready?.id ?? null,
      snapshotDate: ready?.snapshotDate ?? null,
      sourceTurnoverDate: ready?.sourceTurnoverDate ?? null,
      sourceSalesAsOf: ready?.sourceSalesAsOf ?? null,
      rowCount: ready?.rowCount ?? null,
      meta: ready?.meta ?? null,
      finishedAt: ready?.finishedAt ? ready.finishedAt.toISOString() : null,
    },
    failed: showFailed
      ? {
          runId: failed!.id,
          errorMessage: failed!.errorMessage ?? null,
          createdAt: failed!.createdAt ? failed!.createdAt.toISOString() : null,
        }
      : null,
    skipped: skipped
      ? {
          runId: skipped.id,
          message: skipped.errorMessage ?? null,
          createdAt: skipped.createdAt ? skipped.createdAt.toISOString() : null,
        }
      : null,
  };
}

async function getLatestReadyRunId(): Promise<string | null> {
  const [row] = await db
    .select({ id: inventorySalesCubeRuns.id })
    .from(inventorySalesCubeRuns)
    .where(eq(inventorySalesCubeRuns.status, 'ready'))
    .orderBy(desc(inventorySalesCubeRuns.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export type InventorySalesCubeQueryFilters = {
  /** SKU：单值模糊；多值（逗号/空格/分号）精确匹配，与销量预测同口径 */
  q?: string;
  /** 物理仓多选；空=全部 */
  warehouseCodes?: string[];
  /** 品类多选；含 `__none__` 表示空品类 */
  categories?: string[];
  /** 生命周期多选；含 `__none__` 表示空生命周期 */
  lifecycles?: string[];
  primaryRisk?: string;
  productScope?: string;
  salesCountry?: string;
  /** 覆盖组距；见 CoverBandKey */
  coverBand?: string;
  /**
   * 是否包含「有效供给=0 且近30d销量=0」的空闲行。
   * 默认 false：不展示无库存且无动销行。
   */
  includeIdle?: boolean;
};

const MAX_CUBE_FILTER_VALUES = 50;
const NONE_BUCKET_KEY = '__none__';

/** 规范化多选筛选项：去空白、去重，超限抛错。 */
export function normalizeCubeMultiFilter(
  values: string[] | undefined,
  label: string,
): string[] | undefined {
  if (!values?.length) return undefined;
  const next = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (next.length > MAX_CUBE_FILTER_VALUES) {
    throw new Error(`${label}最多选择 ${MAX_CUBE_FILTER_VALUES} 个`);
  }
  return next.length ? next : undefined;
}

function multiOrNoneFilter(
  values: string[],
  column: typeof inventorySalesCubeRows.category | typeof inventorySalesCubeRows.lifecycle,
) {
  const hasNone = values.includes(NONE_BUCKET_KEY);
  const concretes = values.filter((v) => v !== NONE_BUCKET_KEY);
  const parts = [];
  if (hasNone) {
    parts.push(sql`(${column} IS NULL OR TRIM(${column}) = '')`);
  }
  if (concretes.length) {
    parts.push(inArray(column, concretes));
  }
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0]! : or(...parts);
}

export type ListInventorySalesCubeRowsFilters = InventorySalesCubeQueryFilters & {
  page: number;
  pageSize: number;
};

function coverBandSqlExpr() {
  return sql<string>`CASE
    WHEN ${inventorySalesCubeRows.coverDays} IS NULL THEN 'no_velocity'
    WHEN ${inventorySalesCubeRows.coverDays} <= 14 THEN 'd0_14'
    WHEN ${inventorySalesCubeRows.coverDays} <= 30 THEN 'd15_30'
    WHEN ${inventorySalesCubeRows.coverDays} <= 90 THEN 'd31_90'
    ELSE 'd90_plus'
  END`;
}

function buildInventorySalesCubeWhere(runId: string, filters: InventorySalesCubeQueryFilters) {
  const conditions = [eq(inventorySalesCubeRows.runId, runId)];
  const skuQuery = parseForecastSkuQuery(filters.q);
  if (skuQuery.kind === 'fuzzy') {
    conditions.push(ilike(inventorySalesCubeRows.skuCode, `%${skuQuery.token}%`));
  } else if (skuQuery.kind === 'exact') {
    if (skuQuery.codes.length > MAX_CUBE_FILTER_VALUES) {
      throw new Error(`SKU 最多填写 ${MAX_CUBE_FILTER_VALUES} 个`);
    }
    conditions.push(inArray(sql`upper(${inventorySalesCubeRows.skuCode})`, skuQuery.codes));
  }
  const warehouseCodes = normalizeCubeMultiFilter(filters.warehouseCodes, '仓库');
  if (warehouseCodes?.length) {
    conditions.push(inArray(inventorySalesCubeRows.warehouseCode, warehouseCodes));
  }
  const categories = normalizeCubeMultiFilter(filters.categories, '品类');
  if (categories?.length) {
    const catCond = multiOrNoneFilter(categories, inventorySalesCubeRows.category);
    if (catCond) conditions.push(catCond);
  }
  const lifecycles = normalizeCubeMultiFilter(filters.lifecycles, '生命周期');
  if (lifecycles?.length) {
    const lifeCond = multiOrNoneFilter(lifecycles, inventorySalesCubeRows.lifecycle);
    if (lifeCond) conditions.push(lifeCond);
  }
  if (filters.primaryRisk) {
    if (filters.primaryRisk === 'none') {
      conditions.push(isNull(inventorySalesCubeRows.primaryRisk));
    } else {
      conditions.push(eq(inventorySalesCubeRows.primaryRisk, filters.primaryRisk));
    }
  }
  if (filters.productScope) {
    conditions.push(eq(inventorySalesCubeRows.productScope, filters.productScope));
  }
  if (filters.salesCountry) {
    conditions.push(eq(inventorySalesCubeRows.salesCountry, filters.salesCountry));
  }
  if (filters.coverBand) {
    if (!isCoverBandKey(filters.coverBand)) {
      throw new Error(`无效的 coverBand：${filters.coverBand}`);
    }
    conditions.push(sql`${coverBandSqlExpr()} = ${filters.coverBand}`);
  }
  // 默认隐藏：有效供给=0 且近30d销量为空/0（无库存且无动销）
  if (!filters.includeIdle) {
    conditions.push(
      sql`(${inventorySalesCubeRows.effectiveQty} > 0 OR COALESCE(${inventorySalesCubeRows.sales30d}, 0) > 0)`,
    );
  }
  return and(...conditions);
}

export type InventorySalesCubeRowItem = {
  id: string;
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  productScope: string;
  category: string | null;
  lifecycle: string | null;
  salesCountry: string | null;
  qtyAvailable: number;
  qtyInTransit: number;
  /** 国内未发（已下单供应商未发出）；SKU 级，不计入 effectiveQty */
  qtyDomesticUnshipped: number;
  effectiveQty: number;
  shareMethod: string;
  shareWeight: number | null;
  sales7d: number | null;
  sales14d: number | null;
  sales30d: number | null;
  avgDaily30d: number | null;
  coverDays: number | null;
  sellThrough30d: number | null;
  primaryRisk: string | null;
  riskTags: string[];
};

export type ListInventorySalesCubeRowsResult = {
  items: InventorySalesCubeRowItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    rowCount: number;
    stockoutRisk: number;
    slowMoving: number;
    imbalance: number;
    unallocated: number;
  };
  meta: {
    runId: string | null;
    snapshotDate: string | null;
  };
};

export async function listInventorySalesCubeRows(
  filters: ListInventorySalesCubeRowsFilters,
): Promise<ListInventorySalesCubeRowsResult> {
  const runId = await getLatestReadyRunId();
  if (!runId) {
    return {
      items: [],
      total: 0,
      page: filters.page,
      pageSize: filters.pageSize,
      summary: { rowCount: 0, stockoutRisk: 0, slowMoving: 0, imbalance: 0, unallocated: 0 },
      meta: { runId: null, snapshotDate: null },
    };
  }

  const where = buildInventorySalesCubeWhere(runId, filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows, [totalRow], [summaryRow], [runMeta]] = await Promise.all([
    db
      .select({
        id: inventorySalesCubeRows.id,
        skuId: inventorySalesCubeRows.skuId,
        skuCode: inventorySalesCubeRows.skuCode,
        warehouseCode: inventorySalesCubeRows.warehouseCode,
        productScope: inventorySalesCubeRows.productScope,
        category: inventorySalesCubeRows.category,
        lifecycle: inventorySalesCubeRows.lifecycle,
        salesCountry: inventorySalesCubeRows.salesCountry,
        qtyAvailable: inventorySalesCubeRows.qtyAvailable,
        qtyInTransit: inventorySalesCubeRows.qtyInTransit,
        qtyDomesticUnshipped: inventorySalesCubeRows.qtyDomesticUnshipped,
        effectiveQty: inventorySalesCubeRows.effectiveQty,
        shareMethod: inventorySalesCubeRows.shareMethod,
        shareWeight: inventorySalesCubeRows.shareWeight,
        sales7d: inventorySalesCubeRows.sales7d,
        sales14d: inventorySalesCubeRows.sales14d,
        sales30d: inventorySalesCubeRows.sales30d,
        avgDaily30d: inventorySalesCubeRows.avgDaily30d,
        coverDays: inventorySalesCubeRows.coverDays,
        sellThrough30d: inventorySalesCubeRows.sellThrough30d,
        primaryRisk: inventorySalesCubeRows.primaryRisk,
        riskTags: inventorySalesCubeRows.riskTags,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .orderBy(inventorySalesCubeRows.skuCode, inventorySalesCubeRows.warehouseCode)
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(inventorySalesCubeRows)
      .where(where),
    db
      .select({
        rowCount: count(),
        stockoutRisk: count(sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'stockout_risk' THEN 1 END`),
        slowMoving: count(sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'slow_moving' THEN 1 END`),
        imbalance: count(sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'imbalance' THEN 1 END`),
        unallocated: count(sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'unallocated' THEN 1 END`),
      })
      .from(inventorySalesCubeRows)
      .where(where),
    db
      .select({
        snapshotDate: inventorySalesCubeRuns.snapshotDate,
      })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.id, runId))
      .limit(1),
  ]);

  return {
    items: rows.map((r) => ({
      ...r,
      qtyDomesticUnshipped: r.qtyDomesticUnshipped ?? 0,
      riskTags: r.riskTags ?? [],
    })),
    total: Number(totalRow?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
    summary: {
      rowCount: Number(summaryRow?.rowCount ?? 0),
      stockoutRisk: Number(summaryRow?.stockoutRisk ?? 0),
      slowMoving: Number(summaryRow?.slowMoving ?? 0),
      imbalance: Number(summaryRow?.imbalance ?? 0),
      unallocated: Number(summaryRow?.unallocated ?? 0),
    },
    meta: {
      runId,
      snapshotDate: runMeta?.snapshotDate ?? null,
    },
  };
}

export type InventorySalesBreakdownBucket = {
  key: string;
  label: string;
  rowCount: number;
  effectiveQtySum: number;
  sales30dSum: number;
};

export type InventorySalesAnalyticsOverview = {
  totals: {
    rowCount: number;
    effectiveQtySum: number;
    sales7dSum: number;
    sales14dSum: number;
    sales30dSum: number;
    avgCoverDays: number | null;
    withVelocityRowCount: number;
    stockoutRisk: number;
    slowMoving: number;
    imbalance: number;
    unallocated: number;
  };
  breakdowns: {
    byRisk: InventorySalesBreakdownBucket[];
    byWarehouse: InventorySalesBreakdownBucket[];
    byCategory: InventorySalesBreakdownBucket[];
    byLifecycle: InventorySalesBreakdownBucket[];
    byCoverBand: InventorySalesBreakdownBucket[];
  };
  meta: {
    runId: string | null;
    snapshotDate: string | null;
    sourceSalesAsOf: string | null;
    coverBandsVersion: typeof COVER_BAND_VERSION;
  };
};

const RISK_BUCKET_LABELS: Record<string, string> = {
  stockout_risk: '缺货风险',
  slow_moving: '滞销',
  imbalance: '仓间失衡',
  unallocated: '未分配',
  none: '无主风险',
};

function mapBreakdownRows(
  rows: Array<{
    key: string | null;
    rowCount: number;
    effectiveQtySum: string | number | null;
    sales30dSum: string | number | null;
  }>,
  labelOf: (key: string) => string,
  options?: { emptyAsNone?: boolean },
): InventorySalesBreakdownBucket[] {
  const merged = new Map<string, InventorySalesBreakdownBucket>();
  for (const r of rows) {
    const raw = r.key;
    const key = options?.emptyAsNone
      ? raw == null || !String(raw).trim()
        ? NONE_BUCKET_KEY
        : String(raw).trim()
      : (raw ?? NONE_BUCKET_KEY);
    const rowCount = Number(r.rowCount ?? 0);
    const effectiveQtySum = Number(r.effectiveQtySum ?? 0);
    const sales30dSum = Number(r.sales30dSum ?? 0);
    const prev = merged.get(key);
    if (prev) {
      prev.rowCount += rowCount;
      prev.effectiveQtySum += effectiveQtySum;
      prev.sales30dSum += sales30dSum;
    } else {
      merged.set(key, {
        key,
        label: labelOf(key),
        rowCount,
        effectiveQtySum,
        sales30dSum,
      });
    }
  }
  return [...merged.values()]
    .filter((b) => b.rowCount > 0)
    .sort((a, b) => b.rowCount - a.rowCount || a.key.localeCompare(b.key));
}

export async function getInventorySalesAnalyticsOverview(
  filters: InventorySalesCubeQueryFilters,
): Promise<InventorySalesAnalyticsOverview> {
  const empty: InventorySalesAnalyticsOverview = {
    totals: {
      rowCount: 0,
      effectiveQtySum: 0,
      sales7dSum: 0,
      sales14dSum: 0,
      sales30dSum: 0,
      avgCoverDays: null,
      withVelocityRowCount: 0,
      stockoutRisk: 0,
      slowMoving: 0,
      imbalance: 0,
      unallocated: 0,
    },
    breakdowns: {
      byRisk: [],
      byWarehouse: [],
      byCategory: [],
      byLifecycle: [],
      byCoverBand: [],
    },
    meta: {
      runId: null,
      snapshotDate: null,
      sourceSalesAsOf: null,
      coverBandsVersion: COVER_BAND_VERSION,
    },
  };

  const runId = await getLatestReadyRunId();
  if (!runId) return empty;

  const where = buildInventorySalesCubeWhere(runId, filters);
  const sumEffective = sql<string>`COALESCE(SUM(${inventorySalesCubeRows.effectiveQty}), 0)`;
  const sumSales30 = sql<string>`COALESCE(SUM(COALESCE(${inventorySalesCubeRows.sales30d}, 0)), 0)`;
  const sumSales7 = sql<string>`COALESCE(SUM(COALESCE(${inventorySalesCubeRows.sales7d}, 0)), 0)`;
  const sumSales14 = sql<string>`COALESCE(SUM(COALESCE(${inventorySalesCubeRows.sales14d}, 0)), 0)`;

  const [
    [totalsRow],
    riskRows,
    warehouseRows,
    categoryRows,
    lifecycleRows,
    coverBandRows,
    [runMeta],
  ] = await Promise.all([
    db
      .select({
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales7dSum: sumSales7,
        sales14dSum: sumSales14,
        sales30dSum: sumSales30,
        avgCoverDays: sql<string | null>`AVG(${inventorySalesCubeRows.coverDays})`,
        withVelocityRowCount: count(
          sql`CASE WHEN ${inventorySalesCubeRows.coverDays} IS NOT NULL THEN 1 END`,
        ),
        stockoutRisk: count(
          sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'stockout_risk' THEN 1 END`,
        ),
        slowMoving: count(
          sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'slow_moving' THEN 1 END`,
        ),
        imbalance: count(
          sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'imbalance' THEN 1 END`,
        ),
        unallocated: count(
          sql`CASE WHEN ${inventorySalesCubeRows.primaryRisk} = 'unallocated' THEN 1 END`,
        ),
      })
      .from(inventorySalesCubeRows)
      .where(where),
    db
      .select({
        key: inventorySalesCubeRows.primaryRisk,
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales30dSum: sumSales30,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .groupBy(inventorySalesCubeRows.primaryRisk),
    db
      .select({
        key: inventorySalesCubeRows.warehouseCode,
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales30dSum: sumSales30,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .groupBy(inventorySalesCubeRows.warehouseCode),
    db
      .select({
        key: inventorySalesCubeRows.category,
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales30dSum: sumSales30,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .groupBy(inventorySalesCubeRows.category),
    db
      .select({
        key: inventorySalesCubeRows.lifecycle,
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales30dSum: sumSales30,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .groupBy(inventorySalesCubeRows.lifecycle),
    db
      .select({
        key: coverBandSqlExpr().as('cover_band'),
        rowCount: count(),
        effectiveQtySum: sumEffective,
        sales30dSum: sumSales30,
      })
      .from(inventorySalesCubeRows)
      .where(where)
      .groupBy(coverBandSqlExpr()),
    db
      .select({
        snapshotDate: inventorySalesCubeRuns.snapshotDate,
        sourceSalesAsOf: inventorySalesCubeRuns.sourceSalesAsOf,
      })
      .from(inventorySalesCubeRuns)
      .where(eq(inventorySalesCubeRuns.id, runId))
      .limit(1),
  ]);

  const avgRaw = totalsRow?.avgCoverDays;
  const avgCoverDays =
    avgRaw == null || avgRaw === ''
      ? null
      : Number.isFinite(Number(avgRaw))
        ? Number(avgRaw)
        : null;

  return {
    totals: {
      rowCount: Number(totalsRow?.rowCount ?? 0),
      effectiveQtySum: Number(totalsRow?.effectiveQtySum ?? 0),
      sales7dSum: Number(totalsRow?.sales7dSum ?? 0),
      sales14dSum: Number(totalsRow?.sales14dSum ?? 0),
      sales30dSum: Number(totalsRow?.sales30dSum ?? 0),
      avgCoverDays,
      withVelocityRowCount: Number(totalsRow?.withVelocityRowCount ?? 0),
      stockoutRisk: Number(totalsRow?.stockoutRisk ?? 0),
      slowMoving: Number(totalsRow?.slowMoving ?? 0),
      imbalance: Number(totalsRow?.imbalance ?? 0),
      unallocated: Number(totalsRow?.unallocated ?? 0),
    },
    breakdowns: {
      byRisk: mapBreakdownRows(
        riskRows.map((r) => ({ ...r, key: r.key ?? 'none' })),
        (k) => RISK_BUCKET_LABELS[k] ?? k,
      ),
      byWarehouse: mapBreakdownRows(warehouseRows, (k) => k),
      byCategory: mapBreakdownRows(
        categoryRows,
        (k) => (k === NONE_BUCKET_KEY ? '未分类' : k),
        { emptyAsNone: true },
      ),
      byLifecycle: mapBreakdownRows(
        lifecycleRows,
        (k) => (k === NONE_BUCKET_KEY ? '未标注' : k),
        { emptyAsNone: true },
      ),
      byCoverBand: mapBreakdownRows(coverBandRows, (k) =>
        isCoverBandKey(k) ? COVER_BAND_LABELS[k] : k,
      ).sort((a, b) => {
        const order = ['d0_14', 'd15_30', 'd31_90', 'd90_plus', 'no_velocity'];
        return order.indexOf(a.key) - order.indexOf(b.key);
      }),
    },
    meta: {
      runId,
      snapshotDate: runMeta?.snapshotDate ?? null,
      sourceSalesAsOf: runMeta?.sourceSalesAsOf ?? null,
      coverBandsVersion: COVER_BAND_VERSION,
    },
  };
}

export type InventorySalesCubeSkuDetail = {
  rows: InventorySalesCubeRowItem[];
  queryReconcile: {
    available: boolean;
    note?: string;
    highlights?: Record<string, string>;
  } | null;
};

export async function getInventorySalesCubeSkuDetail(
  skuId: string,
): Promise<InventorySalesCubeSkuDetail> {
  const runId = await getLatestReadyRunId();
  if (!runId) {
    return { rows: [], queryReconcile: null };
  }

  const rows = await db
    .select({
      id: inventorySalesCubeRows.id,
      skuId: inventorySalesCubeRows.skuId,
      skuCode: inventorySalesCubeRows.skuCode,
      warehouseCode: inventorySalesCubeRows.warehouseCode,
      productScope: inventorySalesCubeRows.productScope,
      category: inventorySalesCubeRows.category,
      lifecycle: inventorySalesCubeRows.lifecycle,
      salesCountry: inventorySalesCubeRows.salesCountry,
      qtyAvailable: inventorySalesCubeRows.qtyAvailable,
      qtyInTransit: inventorySalesCubeRows.qtyInTransit,
      qtyDomesticUnshipped: inventorySalesCubeRows.qtyDomesticUnshipped,
      effectiveQty: inventorySalesCubeRows.effectiveQty,
      shareMethod: inventorySalesCubeRows.shareMethod,
      shareWeight: inventorySalesCubeRows.shareWeight,
      sales7d: inventorySalesCubeRows.sales7d,
      sales14d: inventorySalesCubeRows.sales14d,
      sales30d: inventorySalesCubeRows.sales30d,
      avgDaily30d: inventorySalesCubeRows.avgDaily30d,
      coverDays: inventorySalesCubeRows.coverDays,
      sellThrough30d: inventorySalesCubeRows.sellThrough30d,
      primaryRisk: inventorySalesCubeRows.primaryRisk,
      riskTags: inventorySalesCubeRows.riskTags,
    })
    .from(inventorySalesCubeRows)
    .where(
      and(
        eq(inventorySalesCubeRows.runId, runId),
        eq(inventorySalesCubeRows.skuId, skuId),
      ),
    )
    .orderBy(inventorySalesCubeRows.warehouseCode);

  const queryReconcile = await resolveQueryReconcile(skuId);

  return {
    rows: rows.map((r) => ({ ...r, riskTags: r.riskTags ?? [] })),
    queryReconcile,
  };
}

/** 软读 inventory-query 只读快照；缺失则返回 { available:false, note:'无查询快照' }。 */
async function resolveQueryReconcile(skuId: string): Promise<{
  available: boolean;
  note?: string;
  highlights?: Record<string, string>;
}> {
  // 复用 inventory-query-snapshot 的 published 选择逻辑
  const { getPublishedQuerySnapshotDate, loadInventoryQuerySnapshots } = await import(
    './inventory-query-snapshot.js'
  );
  const meta = await getPublishedQuerySnapshotDate();
  if (!meta.selectedSnapshotDate) {
    return { available: false, note: '无查询快照' };
  }
  const snapshots = await loadInventoryQuerySnapshots({
    snapshotDate: meta.selectedSnapshotDate,
    limit: 100,
  });
  const matched = snapshots.find((s) => s.skuId === skuId);
  if (!matched) {
    return { available: false, note: '无查询快照' };
  }
  const highlights: Record<string, string> = {};
  for (const key of ['品类', '销售国家', '生命周期', '海外仓库存_合计', '调拨在途_合计']) {
    const v = matched.payload[key];
    if (v) highlights[key] = v;
  }
  return { available: true, highlights };
}
