import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  inventoryQueryDailySnapshots,
  inventoryQuerySnapshotRuns,
} from '@scm/db';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { resolveInventorySnapshotSelection } from './inventory-overview-history.js';

export type InventoryQuerySnapshotItem = {
  skuCode: string;
  skuId: string | null;
  payload: Record<string, string>;
};

export type InventoryQuerySnapshotDateOption = {
  snapshotDate: string;
  syncedAt: string;
  rowCount: number;
};

/** 飞书偶发重复 SKU 时，以本次拉取中最后出现的记录为准。 */
export function dedupeQuerySnapshotItemsBySkuCode<T extends { skuCode: string }>(
  items: T[],
): T[] {
  const byCode = new Map<string, T>();
  for (const item of items) {
    const code = item.skuCode.trim();
    if (!code) continue;
    if (byCode.has(code)) byCode.delete(code);
    byCode.set(code, item);
  }
  return Array.from(byCode.values());
}

export function assertQuerySnapshotPublishable(input: {
  imported: number;
  itemCount: number;
  warningCount?: number;
}): void {
  if (input.imported <= 0 || input.itemCount <= 0) {
    throw new Error('库存查询同步没有可归档数据，本次不发布每日快照。');
  }
}

export async function publishInventoryQuerySnapshot(input: {
  items: InventoryQuerySnapshotItem[];
  imported: number;
  snapshotDate?: string;
  syncedAt?: Date;
  source?: string;
  columns?: string[];
}): Promise<{ runId: string; snapshotDate: string; rowCount: number }> {
  const items = dedupeQuerySnapshotItemsBySkuCode(input.items);
  assertQuerySnapshotPublishable({
    imported: input.imported,
    itemCount: items.length,
  });

  const syncedAt = input.syncedAt ?? new Date();
  const snapshotDate = input.snapshotDate ?? getShanghaiBusinessDate(syncedAt);
  const columns =
    input.columns?.length
      ? input.columns
      : Array.from(
          items.reduce((set, item) => {
            for (const key of Object.keys(item.payload)) set.add(key);
            return set;
          }, new Set<string>()),
        );

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'inventory-query-snapshot:' + snapshotDate}))`,
    );

    await tx
      .update(inventoryQuerySnapshotRuns)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(inventoryQuerySnapshotRuns.snapshotDate, snapshotDate),
          eq(inventoryQuerySnapshotRuns.status, 'published'),
        ),
      );

    const [run] = await tx
      .insert(inventoryQuerySnapshotRuns)
      .values({
        snapshotDate,
        syncedAt,
        source: input.source ?? 'feishu-bitable',
        status: 'published',
        rowCount: items.length,
        columns,
      })
      .returning({ id: inventoryQuerySnapshotRuns.id });

    if (!run) throw new Error('创建库存查询每日快照批次失败。');

    await tx
      .delete(inventoryQueryDailySnapshots)
      .where(eq(inventoryQueryDailySnapshots.snapshotDate, snapshotDate));

    const chunkSize = 500;
    for (let offset = 0; offset < items.length; offset += chunkSize) {
      const chunk = items.slice(offset, offset + chunkSize);
      await tx.insert(inventoryQueryDailySnapshots).values(
        chunk.map((item) => ({
          runId: run.id,
          snapshotDate,
          skuId: item.skuId,
          skuCode: item.skuCode,
          payload: item.payload,
        })),
      );
    }

    return { runId: run.id, snapshotDate, rowCount: items.length };
  });
}

export async function listInventoryQuerySnapshotDates(): Promise<
  InventoryQuerySnapshotDateOption[]
> {
  const rows = await db
    .select({
      snapshotDate: inventoryQuerySnapshotRuns.snapshotDate,
      syncedAt: inventoryQuerySnapshotRuns.syncedAt,
      rowCount: inventoryQuerySnapshotRuns.rowCount,
    })
    .from(inventoryQuerySnapshotRuns)
    .where(eq(inventoryQuerySnapshotRuns.status, 'published'))
    .orderBy(desc(inventoryQuerySnapshotRuns.snapshotDate));

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    syncedAt: row.syncedAt.toISOString(),
    rowCount: row.rowCount,
  }));
}

export async function getPublishedQuerySnapshotDate(requestedDate?: string): Promise<{
  selectedSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  isLatestSnapshot: boolean;
  isStale: boolean;
  syncedAt: string | null;
  rowCount: number | null;
  columns: string[];
}> {
  const dates = await listInventoryQuerySnapshotDates();
  const selection = resolveInventorySnapshotSelection(
    dates.map((item) => item.snapshotDate),
    requestedDate,
    getShanghaiBusinessDate(),
  );
  const selected = dates.find((d) => d.snapshotDate === selection.selectedSnapshotDate);

  let columns: string[] = [];
  if (selection.selectedSnapshotDate) {
    const [run] = await db
      .select({ columns: inventoryQuerySnapshotRuns.columns })
      .from(inventoryQuerySnapshotRuns)
      .where(
        and(
          eq(inventoryQuerySnapshotRuns.snapshotDate, selection.selectedSnapshotDate),
          eq(inventoryQuerySnapshotRuns.status, 'published'),
        ),
      )
      .limit(1);
    if (Array.isArray(run?.columns)) columns = run.columns.filter((c): c is string => typeof c === 'string');
  }

  return {
    ...selection,
    syncedAt: selected?.syncedAt ?? null,
    rowCount: selected?.rowCount ?? null,
    columns,
  };
}

export async function loadInventoryQuerySnapshots(input: {
  snapshotDate: string;
  limit?: number;
  offset?: number;
}): Promise<
  Array<{
    snapshotDate: string;
    skuId: string | null;
    skuCode: string;
    payload: Record<string, string>;
  }>
> {
  const rows = await db
    .select({
      snapshotDate: inventoryQueryDailySnapshots.snapshotDate,
      skuId: inventoryQueryDailySnapshots.skuId,
      skuCode: inventoryQueryDailySnapshots.skuCode,
      payload: inventoryQueryDailySnapshots.payload,
    })
    .from(inventoryQueryDailySnapshots)
    .where(eq(inventoryQueryDailySnapshots.snapshotDate, input.snapshotDate))
    .orderBy(asc(inventoryQueryDailySnapshots.skuCode))
    .limit(input.limit ?? 50_000)
    .offset(input.offset ?? 0);

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    skuId: row.skuId,
    skuCode: row.skuCode,
    payload: (row.payload ?? {}) as Record<string, string>,
  }));
}

export async function countInventoryQuerySnapshots(snapshotDate: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryQueryDailySnapshots)
    .where(eq(inventoryQueryDailySnapshots.snapshotDate, snapshotDate));
  return Number(row?.count ?? 0);
}
