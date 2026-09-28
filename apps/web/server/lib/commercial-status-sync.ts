/**
 * 从已归档快照 / 采购列表回写 ERP 商业状态（Phase 2）。
 * 优先级：周转 meta > 库存查询 > 采购备货（取最严重 norm）。
 */
import { desc, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  inventoryDailySnapshots,
  inventoryQueryDailySnapshots,
  inventoryQuerySnapshotRuns,
  procurementListRows,
  skus,
} from '@scm/db';
import {
  applyCommercialStatus,
  extractCommercialStatusRaw,
  extractProductStatusRaw,
  type CommercialStatusSource,
} from './commercial-status.js';
import type { ProcurementListKey } from './procurement-bitable-list.js';

export type CommercialStatusSyncResult = {
  source: CommercialStatusSource | 'reconcile';
  scanned: number;
  updated: number;
  skipped: number;
  locked: number;
  unchanged: number;
};

function emptyResult(source: CommercialStatusSource | 'reconcile'): CommercialStatusSyncResult {
  return { source, scanned: 0, updated: 0, skipped: 0, locked: 0, unchanged: 0 };
}

async function applyRows(
  rows: Array<{ skuId: string; rawStatus: string; source: CommercialStatusSource }>,
  source: CommercialStatusSource | 'reconcile',
): Promise<CommercialStatusSyncResult> {
  const result = emptyResult(source);
  result.scanned = rows.length;

  for (const row of rows) {
    const outcome = await applyCommercialStatus({
      skuId: row.skuId,
      rawStatus: row.rawStatus,
      source: row.source,
    });
    if (outcome === 'updated') result.updated += 1;
    else if (outcome === 'locked') result.locked += 1;
    else if (outcome === 'unchanged') result.unchanged += 1;
    else result.skipped += 1;
  }

  return result;
}

/** 商品主数据 encoding_meta.turnoverSnapshot 中的生命周期/产品状态 */
export async function syncCommercialStatusFromSkuTurnoverMeta(): Promise<CommercialStatusSyncResult> {
  const rows = await db
    .select({
      id: skus.id,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const pending: Array<{ skuId: string; rawStatus: string; source: CommercialStatusSource }> = [];
  for (const row of rows) {
    const meta = row.encodingMeta as Record<string, unknown> | null;
    const snapshot =
      meta?.turnoverSnapshot && typeof meta.turnoverSnapshot === 'object'
        ? (meta.turnoverSnapshot as Record<string, string>)
        : null;
    if (!snapshot) continue;
    const raw = extractProductStatusRaw(snapshot);
    if (!raw) continue;
    pending.push({ skuId: row.id, rawStatus: raw, source: 'erp_turnover' });
  }

  return applyRows(pending, 'erp_turnover');
}

/** 最新库存周转日快照 payload（turnoverExtras / 顶层键） */
export async function syncCommercialStatusFromInventoryDailySnapshots(): Promise<CommercialStatusSyncResult> {
  const latestDateRows = await db.execute(sql`
    SELECT max(snapshot_date)::text AS d FROM inventory_daily_snapshots
  `);
  const latestDate = String((latestDateRows as unknown as Array<{ d: string }>)[0]?.d ?? '');
  if (!latestDate) return emptyResult('erp_turnover');

  const snapRows = await db
    .select({
      skuId: inventoryDailySnapshots.skuId,
      payload: inventoryDailySnapshots.payload,
    })
    .from(inventoryDailySnapshots)
    .where(eq(inventoryDailySnapshots.snapshotDate, latestDate));

  const pending: Array<{ skuId: string; rawStatus: string; source: CommercialStatusSource }> = [];
  for (const row of snapRows) {
    const payload =
      typeof row.payload === 'string'
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload as Record<string, unknown>);
    const extras =
      payload.turnoverExtras && typeof payload.turnoverExtras === 'object'
        ? (payload.turnoverExtras as Record<string, string>)
        : {};
    const raw =
      extractProductStatusRaw(extras) ?? extractProductStatusRaw(payload);
    if (!raw) continue;
    pending.push({ skuId: row.skuId, rawStatus: raw, source: 'erp_turnover' });
  }

  return applyRows(pending, 'erp_turnover');
}

/** 已发布库存查询日快照（产品状态） */
export async function syncCommercialStatusFromInventoryQuerySnapshot(params?: {
  snapshotDate?: string;
}): Promise<CommercialStatusSyncResult> {
  let snapshotDate = params?.snapshotDate?.trim();
  if (!snapshotDate) {
    const [latest] = await db
      .select({ snapshotDate: inventoryQuerySnapshotRuns.snapshotDate })
      .from(inventoryQuerySnapshotRuns)
      .where(eq(inventoryQuerySnapshotRuns.status, 'published'))
      .orderBy(desc(inventoryQuerySnapshotRuns.snapshotDate))
      .limit(1);
    snapshotDate = latest?.snapshotDate ?? undefined;
  }
  if (!snapshotDate) return emptyResult('erp_query');

  const rows = await db
    .select({
      skuId: inventoryQueryDailySnapshots.skuId,
      skuCode: inventoryQueryDailySnapshots.skuCode,
      payload: inventoryQueryDailySnapshots.payload,
    })
    .from(inventoryQueryDailySnapshots)
    .where(eq(inventoryQueryDailySnapshots.snapshotDate, snapshotDate));

  const pending: Array<{ skuId: string; rawStatus: string; source: CommercialStatusSource }> = [];
  for (const row of rows) {
    const payload =
      typeof row.payload === 'string'
        ? (JSON.parse(row.payload) as Record<string, string>)
        : (row.payload as Record<string, string>);
    const raw = extractCommercialStatusRaw(payload);
    if (!raw) continue;

    let skuId = row.skuId;
    if (!skuId && row.skuCode) {
      const [sku] = await db
        .select({ id: skus.id })
        .from(skus)
        .where(eq(skus.code, row.skuCode))
        .limit(1);
      skuId = sku?.id ?? null;
    }
    if (!skuId) continue;
    pending.push({ skuId, rawStatus: raw, source: 'erp_query' });
  }

  return applyRows(pending, 'erp_query');
}

/** 采购备货申请列表（产品状态） */
export async function syncCommercialStatusFromProcurementList(
  listType: ProcurementListKey = 'bulk_stock_request',
): Promise<CommercialStatusSyncResult> {
  if (listType !== 'bulk_stock_request') return emptyResult('erp_procurement');

  const rows = await db
    .select({
      rowData: procurementListRows.rowData,
    })
    .from(procurementListRows)
    .where(eq(procurementListRows.listType, listType));

  const bySkuCode = new Map<string, string>();
  for (const row of rows) {
    const data = row.rowData ?? {};
    const skuCode = (data.SKU ?? data.sku ?? data['sku_code'] ?? '').trim();
    const raw = extractCommercialStatusRaw(data);
    if (!skuCode || !raw) continue;
    bySkuCode.set(skuCode, raw);
  }

  if (!bySkuCode.size) return emptyResult('erp_procurement');

  const codes = [...bySkuCode.keys()];
  const skuRows = await db
    .select({ id: skus.id, code: skus.code })
    .from(skus)
    .where(inArray(skus.code, codes));

  const pending: Array<{ skuId: string; rawStatus: string; source: CommercialStatusSource }> = [];
  for (const sku of skuRows) {
    const raw = bySkuCode.get(sku.code);
    if (!raw) continue;
    pending.push({ skuId: sku.id, rawStatus: raw, source: 'erp_procurement' });
  }

  return applyRows(pending, 'erp_procurement');
}

/** 按源优先级依次 reconcile（周转 → 查询 → 采购） */
export async function reconcileCommercialStatusFromAllSources(): Promise<{
  results: CommercialStatusSyncResult[];
  totals: CommercialStatusSyncResult;
}> {
  const results: CommercialStatusSyncResult[] = [];

  results.push(await syncCommercialStatusFromInventoryDailySnapshots());
  results.push(await syncCommercialStatusFromSkuTurnoverMeta());
  results.push(await syncCommercialStatusFromInventoryQuerySnapshot());
  results.push(await syncCommercialStatusFromProcurementList('bulk_stock_request'));

  const totals = results.reduce(
    (acc, row) => ({
      source: 'reconcile' as const,
      scanned: acc.scanned + row.scanned,
      updated: acc.updated + row.updated,
      skipped: acc.skipped + row.skipped,
      locked: acc.locked + row.locked,
      unchanged: acc.unchanged + row.unchanged,
    }),
    emptyResult('reconcile'),
  );

  return { results, totals };
}

/** 规划驾驶舱 / 运维：商业状态分布 */
export async function summarizeCommercialStatusDistribution(): Promise<
  Array<{ norm: string | null; count: number }>
> {
  const rows = await db
    .select({
      norm: skus.commercialStatusNorm,
      count: sql<number>`count(*)::int`,
    })
    .from(skus)
    .where(eq(skus.isActive, true))
    .groupBy(skus.commercialStatusNorm)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ norm: row.norm, count: Number(row.count) }));
}
