import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  procurementOpsDailySnapshots,
  procurementOpsSnapshotRuns,
} from '@scm/db';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { resolveInventorySnapshotSelection } from './inventory-overview-history.js';

export type ProcurementOpsSnapshotItem = {
  skuCode: string;
  skuId: string | null;
  payload: Record<string, string>;
};

export type ProcurementOpsSnapshotDateOption = {
  snapshotDate: string;
  syncedAt: string;
  rowCount: number;
};

export function keepProcurementOpsSnapshotItems<T extends { skuCode: string }>(
  items: T[],
): T[] {
  return items.filter((item) => item.skuCode.trim());
}

export function assertProcurementOpsSnapshotPublishable(input: {
  imported: number;
  itemCount: number;
  warningCount?: number;
}): void {
  if (input.imported <= 0 || input.itemCount <= 0) {
    throw new Error('全链库存同步没有可归档数据，本次不发布每日快照。');
  }
}

export async function publishProcurementOpsSnapshot(input: {
  items: ProcurementOpsSnapshotItem[];
  imported: number;
  snapshotDate?: string;
  syncedAt?: Date;
  source?: string;
  columns?: string[];
}): Promise<{ runId: string; snapshotDate: string; rowCount: number }> {
  const items = keepProcurementOpsSnapshotItems(input.items);
  assertProcurementOpsSnapshotPublishable({
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
      sql`SELECT pg_advisory_xact_lock(hashtext(${'procurement-ops-snapshot:' + snapshotDate}))`,
    );

    await tx
      .update(procurementOpsSnapshotRuns)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(procurementOpsSnapshotRuns.snapshotDate, snapshotDate),
          eq(procurementOpsSnapshotRuns.status, 'published'),
        ),
      );

    const [run] = await tx
      .insert(procurementOpsSnapshotRuns)
      .values({
        snapshotDate,
        syncedAt,
        source: input.source ?? 'feishu-bitable',
        status: 'published',
        rowCount: items.length,
        columns,
      })
      .returning({ id: procurementOpsSnapshotRuns.id });

    if (!run) throw new Error('创建全链库存每日快照批次失败。');

    await tx
      .delete(procurementOpsDailySnapshots)
      .where(eq(procurementOpsDailySnapshots.snapshotDate, snapshotDate));

    const chunkSize = 500;
    for (let offset = 0; offset < items.length; offset += chunkSize) {
      const chunk = items.slice(offset, offset + chunkSize);
      await tx.insert(procurementOpsDailySnapshots).values(
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

export async function listProcurementOpsSnapshotDates(): Promise<
  ProcurementOpsSnapshotDateOption[]
> {
  const rows = await db
    .select({
      snapshotDate: procurementOpsSnapshotRuns.snapshotDate,
      syncedAt: procurementOpsSnapshotRuns.syncedAt,
      rowCount: procurementOpsSnapshotRuns.rowCount,
    })
    .from(procurementOpsSnapshotRuns)
    .where(eq(procurementOpsSnapshotRuns.status, 'published'))
    .orderBy(desc(procurementOpsSnapshotRuns.snapshotDate));

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    syncedAt: row.syncedAt.toISOString(),
    rowCount: row.rowCount,
  }));
}

export async function getPublishedProcurementOpsSnapshotDate(requestedDate?: string): Promise<{
  selectedSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  isLatestSnapshot: boolean;
  isStale: boolean;
  syncedAt: string | null;
  rowCount: number | null;
  columns: string[];
}> {
  const dates = await listProcurementOpsSnapshotDates();
  const selection = resolveInventorySnapshotSelection(
    dates.map((item) => item.snapshotDate),
    requestedDate,
    getShanghaiBusinessDate(),
  );
  const selected = dates.find((d) => d.snapshotDate === selection.selectedSnapshotDate);

  let columns: string[] = [];
  if (selection.selectedSnapshotDate) {
    const [run] = await db
      .select({ columns: procurementOpsSnapshotRuns.columns })
      .from(procurementOpsSnapshotRuns)
      .where(
        and(
          eq(procurementOpsSnapshotRuns.snapshotDate, selection.selectedSnapshotDate),
          eq(procurementOpsSnapshotRuns.status, 'published'),
        ),
      )
      .limit(1);
    if (Array.isArray(run?.columns)) {
      columns = run.columns.filter((c): c is string => typeof c === 'string');
    }
  }

  return {
    ...selection,
    syncedAt: selected?.syncedAt ?? null,
    rowCount: selected?.rowCount ?? null,
    columns,
  };
}

export async function loadProcurementOpsSnapshots(input: {
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
      snapshotDate: procurementOpsDailySnapshots.snapshotDate,
      skuId: procurementOpsDailySnapshots.skuId,
      skuCode: procurementOpsDailySnapshots.skuCode,
      payload: procurementOpsDailySnapshots.payload,
    })
    .from(procurementOpsDailySnapshots)
    .where(eq(procurementOpsDailySnapshots.snapshotDate, input.snapshotDate))
    .orderBy(asc(procurementOpsDailySnapshots.skuCode))
    .limit(input.limit ?? 100_000)
    .offset(input.offset ?? 0);

  return rows.map((row) => ({
    snapshotDate: row.snapshotDate,
    skuId: row.skuId,
    skuCode: row.skuCode,
    payload: (row.payload ?? {}) as Record<string, string>,
  }));
}
