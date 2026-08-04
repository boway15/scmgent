import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  inventoryDailySnapshots,
  inventorySnapshotRuns,
} from '@scm/db';
import { resolveInventorySnapshotSelection } from './inventory-overview-history.js';

export type InventorySnapshotPayload = {
  skuId: string;
  code: string;
  turnoverExtras?: Record<string, string>;
  [key: string]: unknown;
};

export type InventorySnapshotDateOption = {
  snapshotDate: string;
  syncedAt: string;
  rowCount: number;
};

export const DEFAULT_INVENTORY_TREND_FIELDS = [
  '海外仓在库',
  '调拨在途合计',
  '供应商订单',
  '预下单',
  '全链条合计库存',
  '预计海外周转天数',
] as const;

/** 使用上海业务日，不受服务端容器 UTC 时区影响。 */
export function getShanghaiBusinessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** 飞书偶发重复 SKU 时，以本次拉取中最后出现的记录为准。 */
export function dedupeSnapshotItemsBySku<T extends InventorySnapshotPayload>(items: T[]): T[] {
  const bySku = new Map<string, T>();
  for (const item of items) {
    if (bySku.has(item.skuId)) bySku.delete(item.skuId);
    bySku.set(item.skuId, item);
  }
  return Array.from(bySku.values());
}

export function assertSnapshotPublishable(input: {
  imported: number;
  errors: string[];
  itemCount: number;
}): void {
  if (input.errors.length > 0) {
    throw new Error(`库存同步存在 ${input.errors.length} 条错误，本次不发布每日快照。`);
  }
  if (input.imported <= 0 || input.itemCount <= 0) {
    throw new Error('库存同步没有可归档数据，本次不发布每日快照。');
  }
}

export function projectInventoryTrend(
  rows: Array<{ snapshotDate: string; payload: { turnoverExtras?: Record<string, string> } }>,
  fields: readonly string[] = DEFAULT_INVENTORY_TREND_FIELDS,
): Array<{ snapshotDate: string; values: Record<string, string> }> {
  return rows.map((row) => {
    const extras = row.payload.turnoverExtras ?? {};
    const values: Record<string, string> = {};
    for (const field of fields) values[field] = extras[field] ?? '-';
    return { snapshotDate: row.snapshotDate, values };
  });
}

export async function publishInventoryDailySnapshot(input: {
  items: InventorySnapshotPayload[];
  imported: number;
  errors: string[];
  snapshotDate?: string;
  syncedAt?: Date;
  importBatchId?: string;
  source?: string;
}): Promise<{ runId: string; snapshotDate: string; rowCount: number }> {
  const items = dedupeSnapshotItemsBySku(input.items);
  assertSnapshotPublishable({
    imported: input.imported,
    errors: input.errors,
    itemCount: items.length,
  });

  const syncedAt = input.syncedAt ?? new Date();
  const snapshotDate = input.snapshotDate ?? getShanghaiBusinessDate(syncedAt);

  return db.transaction(async (tx) => {
    // 串行化同一业务日期的人工/定时发布，防止两个成功批次交叉覆盖。
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'inventory-daily-snapshot:' + snapshotDate}))`,
    );

    await tx
      .update(inventorySnapshotRuns)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(inventorySnapshotRuns.snapshotDate, snapshotDate),
          eq(inventorySnapshotRuns.status, 'published'),
        ),
      );

    const [run] = await tx
      .insert(inventorySnapshotRuns)
      .values({
        snapshotDate,
        syncedAt,
        source: input.source ?? 'feishu-bitable',
        status: 'published',
        rowCount: items.length,
        importBatchId: input.importBatchId,
      })
      .returning({ id: inventorySnapshotRuns.id });

    if (!run) throw new Error('创建库存每日快照批次失败。');

    await tx
      .delete(inventoryDailySnapshots)
      .where(eq(inventoryDailySnapshots.snapshotDate, snapshotDate));

    const chunkSize = 500;
    for (let offset = 0; offset < items.length; offset += chunkSize) {
      const chunk = items.slice(offset, offset + chunkSize);
      await tx.insert(inventoryDailySnapshots).values(
        chunk.map((item) => ({
          runId: run.id,
          snapshotDate,
          skuId: item.skuId,
          skuCode: item.code,
          payload: item,
        })),
      );
    }

    return { runId: run.id, snapshotDate, rowCount: items.length };
  });
}

export async function listInventorySnapshotDates(): Promise<InventorySnapshotDateOption[]> {
  const rows = await db
    .select({
      snapshotDate: inventorySnapshotRuns.snapshotDate,
      syncedAt: inventorySnapshotRuns.syncedAt,
      rowCount: inventorySnapshotRuns.rowCount,
    })
    .from(inventorySnapshotRuns)
    .where(eq(inventorySnapshotRuns.status, 'published'))
    .orderBy(desc(inventorySnapshotRuns.snapshotDate));

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    syncedAt: row.syncedAt.toISOString(),
    rowCount: row.rowCount,
  }));
}

export async function getPublishedSnapshotDate(
  requestedDate?: string,
): Promise<{
  selectedSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  isLatestSnapshot: boolean;
  isStale: boolean;
}> {
  const dates = await listInventorySnapshotDates();
  return resolveInventorySnapshotSelection(
    dates.map((item) => item.snapshotDate),
    requestedDate,
    getShanghaiBusinessDate(),
  );
}

export async function loadInventorySnapshots(input: {
  snapshotDate: string;
  skuIds?: string[];
  skuId?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{ snapshotDate: string; payload: InventorySnapshotPayload }>> {
  const filters = [eq(inventoryDailySnapshots.snapshotDate, input.snapshotDate)];
  if (input.skuId) filters.push(eq(inventoryDailySnapshots.skuId, input.skuId));
  if (input.skuIds?.length) filters.push(inArray(inventoryDailySnapshots.skuId, input.skuIds));

  const query = db
    .select({
      snapshotDate: inventoryDailySnapshots.snapshotDate,
      payload: inventoryDailySnapshots.payload,
    })
    .from(inventoryDailySnapshots)
    .where(and(...filters))
    .orderBy(asc(inventoryDailySnapshots.skuCode))
    .limit(input.limit ?? 20_000)
    .offset(input.offset ?? 0);

  return (await query) as Array<{
    snapshotDate: string;
    payload: InventorySnapshotPayload;
  }>;
}

export async function countInventorySnapshots(snapshotDate: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryDailySnapshots)
    .where(eq(inventoryDailySnapshots.snapshotDate, snapshotDate));
  return Number(row?.count ?? 0);
}

export async function loadInventoryTrend(
  skuId: string,
  fields: readonly string[] = DEFAULT_INVENTORY_TREND_FIELDS,
) {
  const rows = await db
    .select({
      snapshotDate: inventoryDailySnapshots.snapshotDate,
      payload: inventoryDailySnapshots.payload,
    })
    .from(inventoryDailySnapshots)
    .where(eq(inventoryDailySnapshots.skuId, skuId))
    .orderBy(asc(inventoryDailySnapshots.snapshotDate));

  return projectInventoryTrend(
    rows as Array<{
      snapshotDate: string;
      payload: { turnoverExtras?: Record<string, string> };
    }>,
    fields,
  );
}
