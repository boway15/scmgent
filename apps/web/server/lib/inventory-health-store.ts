import { eq, and, desc, isNull, inArray, sql } from 'drizzle-orm';
import {
  db,
  inventoryHealthSnapshots,
  inventoryExceptions,
  reorderSuggestions,
  stockAlerts,
} from '@scm/db';
import type { SkuHealthRow } from './inventory-health-service.js';
import {
  healthToExceptionType,
  recommendedActionForException,
} from './inventory-health-service.js';
import {
  planStaleStockAlertResolve,
  dedupeStockAlertIncoming,
  stockAlertFingerprint,
  stockAlertIntegerQty,
  type StockAlertIncoming,
  type StockAlertUpdate,
} from './stock-alert-sync.js';

/** 大批量 insert 一次 values() 会触发 Maximum call stack size exceeded（SKU×仓可达数万行） */
export const HEALTH_SNAPSHOT_INSERT_CHUNK = 500;

export function chunkRowsForInsert<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');
  if (!items.length) return [];
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    chunks.push(items.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export async function saveHealthSnapshots(
  rows: SkuHealthRow[],
  runId?: string,
): Promise<number> {
  if (!rows.length) return 0;
  const computedAt = new Date();
  const values = rows.map((row) => ({
    skuId: row.skuId,
    warehouseCode: row.warehouseCode,
    healthStatus: row.healthStatus,
    coverageDays: Number.isFinite(row.coverageDays) ? String(row.coverageDays) : null,
    effectiveQty: row.effectiveQty,
    avgDaily: String(row.avgDaily),
    demandSource: row.demandSource,
    totalLeadDays: row.totalLeadDays,
    latestOrderDays: Number.isFinite(row.latestOrderDays)
      ? String(row.latestOrderDays)
      : null,
    metrics: row.metrics,
    computedAt,
    runId: runId ?? null,
  }));

  for (const chunk of chunkRowsForInsert(values, HEALTH_SNAPSHOT_INSERT_CHUNK)) {
    await db.insert(inventoryHealthSnapshots).values(chunk);
  }
  return rows.length;
}

export async function getLatestHealthSnapshots(params?: {
  warehouseCode?: string;
  healthStatus?: string;
  limit?: number;
}) {
  const limit = params?.limit ?? 500;
  const allSkus = await db
    .select({
      id: inventoryHealthSnapshots.id,
      skuId: inventoryHealthSnapshots.skuId,
      warehouseCode: inventoryHealthSnapshots.warehouseCode,
      healthStatus: inventoryHealthSnapshots.healthStatus,
      coverageDays: inventoryHealthSnapshots.coverageDays,
      effectiveQty: inventoryHealthSnapshots.effectiveQty,
      avgDaily: inventoryHealthSnapshots.avgDaily,
      demandSource: inventoryHealthSnapshots.demandSource,
      totalLeadDays: inventoryHealthSnapshots.totalLeadDays,
      latestOrderDays: inventoryHealthSnapshots.latestOrderDays,
      metrics: inventoryHealthSnapshots.metrics,
      computedAt: inventoryHealthSnapshots.computedAt,
    })
    .from(inventoryHealthSnapshots)
    .orderBy(desc(inventoryHealthSnapshots.computedAt))
    .limit(limit * 20);

  const latestByKey = new Map<string, (typeof allSkus)[0]>();
  for (const row of allSkus) {
    const key = `${row.skuId}::${row.warehouseCode}`;
    if (!latestByKey.has(key)) latestByKey.set(key, row);
  }

  let result = Array.from(latestByKey.values());
  if (params?.warehouseCode) {
    result = result.filter((r) => r.warehouseCode === params.warehouseCode);
  }
  if (params?.healthStatus) {
    result = result.filter((r) => r.healthStatus === params.healthStatus);
  }
  return result.slice(0, limit);
}

export async function upsertInventoryExceptions(rows: SkuHealthRow[]): Promise<number> {
  let count = 0;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  const dueStr = dueDate.toISOString().slice(0, 10);

  for (const row of rows) {
    const exceptionType = healthToExceptionType(row.healthStatus, row.lifecycle);
    if (!exceptionType) continue;

    const open = await db
      .select({ id: inventoryExceptions.id })
      .from(inventoryExceptions)
      .where(
        and(
          eq(inventoryExceptions.skuId, row.skuId),
          eq(inventoryExceptions.warehouseCode, row.warehouseCode),
          eq(inventoryExceptions.exceptionType, exceptionType),
          inArray(inventoryExceptions.status, ['open', 'in_progress']),
        ),
      )
      .limit(1);

    if (open.length) continue;

    await db.insert(inventoryExceptions).values({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      exceptionType,
      healthStatus: row.healthStatus,
      recommendedAction: recommendedActionForException(exceptionType),
      status: 'open',
      dueDate: dueStr,
    });
    count++;
  }
  return count;
}

export async function supersedePendingSuggestions(skuId: string, warehouseCode: string) {
  await db
    .update(reorderSuggestions)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(reorderSuggestions.skuId, skuId),
        eq(reorderSuggestions.warehouseCode, warehouseCode),
        eq(reorderSuggestions.status, 'pending'),
        isNull(reorderSuggestions.supersededAt),
      ),
    );
}

/** 网络级补货：同一 SKU 只保留一条 pending 建议 */
export async function supersedeAllPendingSuggestionsForSku(skuId: string) {
  await db
    .update(reorderSuggestions)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(reorderSuggestions.skuId, skuId),
        eq(reorderSuggestions.status, 'pending'),
        isNull(reorderSuggestions.supersededAt),
      ),
    );
}

export async function findOpenStockAlert(params: {
  skuId: string;
  warehouseCode: string | null;
  alertType:
    | 'stockout'
    | 'below_safety'
    | 'below_rop'
    | 'stockout_horizon'
    | 'coverage_short'
    | 'overstock'
    | 'uncoverable_by_new_po';
  horizonDays?: number | null;
}) {
  const conditions = [
    eq(stockAlerts.skuId, params.skuId),
    eq(stockAlerts.alertType, params.alertType),
    eq(stockAlerts.isResolved, false),
  ];
  if (params.warehouseCode) {
    conditions.push(eq(stockAlerts.warehouseCode, params.warehouseCode));
  }
  if (params.horizonDays != null) {
    conditions.push(eq(stockAlerts.horizonDays, params.horizonDays));
  } else if (
    params.alertType === 'stockout_horizon' ||
    params.horizonDays === null
  ) {
    // coverage_short / overstock：horizon 为空
  }
  const [row] = await db
    .select()
    .from(stockAlerts)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function resolveStockAlertsForSkuWarehouse(params: {
  skuId: string;
  warehouseCode: string | null;
  resolvedBy?: string;
}) {
  const conditions = [
    eq(stockAlerts.skuId, params.skuId),
    eq(stockAlerts.isResolved, false),
  ];
  if (params.warehouseCode) {
    conditions.push(eq(stockAlerts.warehouseCode, params.warehouseCode));
  }
  const now = new Date();
  await db
    .update(stockAlerts)
    .set({
      isResolved: true,
      resolvedAt: now,
      resolvedBy: params.resolvedBy ?? null,
    })
    .where(and(...conditions));
}

/**
 * 扫描结束后：本轮未命中的 open 预警自动结案（每日覆盖）。
 * 人工「标记已处理」仍走 resolve 接口；若风险仍在，下次扫描会重新插入。
 */
export async function autoResolveStaleStockAlerts(
  activeFingerprints: Iterable<string>,
): Promise<number> {
  const openRows = await db
    .select({
      id: stockAlerts.id,
      skuId: stockAlerts.skuId,
      warehouseCode: stockAlerts.warehouseCode,
      alertType: stockAlerts.alertType,
      horizonDays: stockAlerts.horizonDays,
    })
    .from(stockAlerts)
    .where(eq(stockAlerts.isResolved, false));

  const staleIds = planStaleStockAlertResolve({
    openAlerts: openRows.map((row) => ({
      id: row.id,
      fingerprint: stockAlertFingerprint({
        skuId: row.skuId,
        warehouseCode: row.warehouseCode,
        alertType: row.alertType,
        horizonDays: row.horizonDays,
      }),
    })),
    activeFingerprints,
  });

  if (!staleIds.length) return 0;

  const now = new Date();
  for (const chunk of chunkRowsForInsert(staleIds, HEALTH_SNAPSHOT_INSERT_CHUNK)) {
    await db
      .update(stockAlerts)
      .set({
        isResolved: true,
        resolvedAt: now,
        resolvedBy: null,
      })
      .where(inArray(stockAlerts.id, chunk));
  }
  return staleIds.length;
}

const STOCK_ALERT_WRITE_CHUNK = 400;

function normalizeStockAlertRow(row: StockAlertIncoming) {
  return {
    skuId: row.skuId,
    warehouseCode: row.warehouseCode,
    alertType: row.alertType as typeof stockAlerts.$inferInsert.alertType,
    currentQty: stockAlertIntegerQty(row.currentQty),
    safetyQty: stockAlertIntegerQty(row.safetyQty),
    horizonDays: row.horizonDays ?? null,
    projectedQty:
      row.projectedQty == null ? null : stockAlertIntegerQty(row.projectedQty),
    projectedStockoutDate: row.projectedStockoutDate ?? null,
  };
}

function normalizeStockAlertUpdate(row: StockAlertUpdate): StockAlertUpdate {
  return {
    id: row.id,
    currentQty: stockAlertIntegerQty(row.currentQty),
    safetyQty: stockAlertIntegerQty(row.safetyQty),
    projectedQty:
      row.projectedQty == null ? null : stockAlertIntegerQty(row.projectedQty),
    projectedStockoutDate: row.projectedStockoutDate,
  };
}

/** 覆盖模式：结案全部 open → 写入本轮去重后的快照（open 行数 = 本轮 activeCount）。 */
export async function applyStockAlertCoverageReplace(incoming: StockAlertIncoming[]): Promise<{
  cleared: number;
  inserted: number;
  activeCount: number;
}> {
  const [openCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAlerts)
    .where(eq(stockAlerts.isResolved, false));
  const cleared = Number(openCountRow?.count ?? 0);

  const now = new Date();
  await db
    .update(stockAlerts)
    .set({
      isResolved: true,
      resolvedAt: now,
      resolvedBy: null,
    })
    .where(eq(stockAlerts.isResolved, false));

  const deduped = dedupeStockAlertIncoming(incoming);
  if (deduped.length) {
    await persistStockAlertBatch({ inserts: deduped, updates: [] });
  }

  return { cleared, inserted: deduped.length, activeCount: deduped.length };
}

export async function persistStockAlertBatch(input: {
  inserts: StockAlertIncoming[];
  updates: StockAlertUpdate[];
}): Promise<void> {
  for (const chunk of chunkRowsForInsert(input.inserts, STOCK_ALERT_WRITE_CHUNK)) {
    await db.insert(stockAlerts).values(chunk.map(normalizeStockAlertRow));
  }

  for (const chunk of chunkRowsForInsert(input.updates, STOCK_ALERT_WRITE_CHUNK)) {
    const normalized = chunk.map(normalizeStockAlertUpdate);
    await db.execute(sql`
      UPDATE stock_alerts AS a
      SET
        current_qty = v.current_qty,
        safety_qty = v.safety_qty,
        projected_qty = v.projected_qty,
        projected_stockout_date = NULLIF(v.projected_stockout_date, '')::date,
        notified_at = NOW()
      FROM (VALUES ${sql.join(
        normalized.map(
          (row) => sql`(
            ${row.id}::uuid,
            ${row.currentQty}::int,
            ${row.safetyQty}::int,
            ${row.projectedQty == null ? sql`NULL::int` : sql`${row.projectedQty}::int`},
            ${row.projectedStockoutDate ?? ''}::text
          )`,
        ),
        sql`, `,
      )}) AS v(id, current_qty, safety_qty, projected_qty, projected_stockout_date)
      WHERE a.id = v.id
    `);
  }
}
