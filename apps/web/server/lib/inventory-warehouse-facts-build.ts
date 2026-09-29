import { and, eq, sql } from 'drizzle-orm';
import {
  db,
  inventoryQueryDailySnapshots,
  inventoryQuerySnapshotRuns,
  procurementOpsDailySnapshots,
  procurementOpsSnapshotRuns,
  warehouseStockFacts,
} from '@scm/db';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { chunkRowsForInsert } from './inventory-health-store.js';
import {
  extractWarehouseFactsFromPayload,
  selectWarehouseFacts,
  type WarehouseFactRow,
  type WarehouseFactSource,
} from './inventory-warehouse-facts.js';

export type WarehouseFactsBuildResult = {
  snapshotDate: string;
  queryRows: number;
  chainRows: number;
  factCount: number;
  selectedCount: number;
  unmatchedQueryColumns: string[];
  unmatchedChainColumns: string[];
  sourceMismatchCount: number;
  skippedSources: WarehouseFactSource[];
};

type SnapshotRow = {
  skuCode: string;
  skuId: string | null;
  payload: unknown;
};

async function loadPublishedSnapshotMeta(
  kind: 'inventory_query' | 'full_chain',
  snapshotDate: string,
): Promise<{ columns: string[]; runId: string } | null> {
  if (kind === 'inventory_query') {
    const [run] = await db
      .select({
        id: inventoryQuerySnapshotRuns.id,
        columns: inventoryQuerySnapshotRuns.columns,
      })
      .from(inventoryQuerySnapshotRuns)
      .where(
        and(
          eq(inventoryQuerySnapshotRuns.snapshotDate, snapshotDate),
          eq(inventoryQuerySnapshotRuns.status, 'published'),
        ),
      )
      .limit(1);
    if (!run) return null;
    const columns = Array.isArray(run.columns)
      ? run.columns.filter((c): c is string => typeof c === 'string')
      : [];
    return { columns, runId: run.id };
  }

  const [run] = await db
    .select({
      id: procurementOpsSnapshotRuns.id,
      columns: procurementOpsSnapshotRuns.columns,
    })
    .from(procurementOpsSnapshotRuns)
    .where(
      and(
        eq(procurementOpsSnapshotRuns.snapshotDate, snapshotDate),
        eq(procurementOpsSnapshotRuns.status, 'published'),
      ),
    )
    .limit(1);
  if (!run) return null;
  const columns = Array.isArray(run.columns)
    ? run.columns.filter((c): c is string => typeof c === 'string')
    : [];
  return { columns, runId: run.id };
}

async function loadSnapshotRows(
  kind: 'inventory_query' | 'full_chain',
  snapshotDate: string,
): Promise<SnapshotRow[]> {
  if (kind === 'inventory_query') {
    const rows = await db
      .select({
        skuCode: inventoryQueryDailySnapshots.skuCode,
        skuId: inventoryQueryDailySnapshots.skuId,
        payload: inventoryQueryDailySnapshots.payload,
      })
      .from(inventoryQueryDailySnapshots)
      .where(eq(inventoryQueryDailySnapshots.snapshotDate, snapshotDate));
    return rows;
  }

  return db
    .select({
      skuCode: procurementOpsDailySnapshots.skuCode,
      skuId: procurementOpsDailySnapshots.skuId,
      payload: procurementOpsDailySnapshots.payload,
    })
    .from(procurementOpsDailySnapshots)
    .where(eq(procurementOpsDailySnapshots.snapshotDate, snapshotDate));
}

function asPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function extractFromSource(params: {
  source: WarehouseFactSource;
  rows: SnapshotRow[];
  columns: string[];
}): { facts: WarehouseFactRow[]; unmatchedQtyColumns: string[] } {
  const facts: WarehouseFactRow[] = [];
  const unmatched = new Set<string>();
  for (const row of params.rows) {
    const extracted = extractWarehouseFactsFromPayload({
      skuCode: row.skuCode,
      skuId: row.skuId,
      source: params.source,
      payload: asPayload(row.payload),
      columns: params.columns.length ? params.columns : undefined,
    });
    facts.push(...extracted.facts);
    for (const col of extracted.unmatchedQtyColumns) unmatched.add(col);
  }
  return { facts, unmatchedQtyColumns: [...unmatched].sort() };
}

/**
 * 从当日已发布的库存查询 / 全链库存快照重建影子长表。
 * 某源无快照则跳过该源；仅当至少有一个源产出事实时才替换当日行。
 */
export async function buildWarehouseStockFacts(params?: {
  snapshotDate?: string;
}): Promise<WarehouseFactsBuildResult> {
  const snapshotDate = params?.snapshotDate ?? getShanghaiBusinessDate();
  const skippedSources: WarehouseFactSource[] = [];
  const allFacts: WarehouseFactRow[] = [];
  let queryRows = 0;
  let chainRows = 0;
  let unmatchedQueryColumns: string[] = [];
  let unmatchedChainColumns: string[] = [];

  const queryMeta = await loadPublishedSnapshotMeta('inventory_query', snapshotDate);
  if (!queryMeta) {
    skippedSources.push('inventory_query');
  } else {
    const rows = await loadSnapshotRows('inventory_query', snapshotDate);
    queryRows = rows.length;
    const extracted = extractFromSource({
      source: 'inventory_query',
      rows,
      columns: queryMeta.columns,
    });
    allFacts.push(...extracted.facts);
    unmatchedQueryColumns = extracted.unmatchedQtyColumns;
  }

  const chainMeta = await loadPublishedSnapshotMeta('full_chain', snapshotDate);
  if (!chainMeta) {
    skippedSources.push('full_chain');
  } else {
    const rows = await loadSnapshotRows('full_chain', snapshotDate);
    chainRows = rows.length;
    const extracted = extractFromSource({
      source: 'full_chain',
      rows,
      columns: chainMeta.columns,
    });
    allFacts.push(...extracted.facts);
    unmatchedChainColumns = extracted.unmatchedQtyColumns;
  }

  if (allFacts.length === 0) {
    return {
      snapshotDate,
      queryRows,
      chainRows,
      factCount: 0,
      selectedCount: 0,
      unmatchedQueryColumns,
      unmatchedChainColumns,
      sourceMismatchCount: 0,
      skippedSources,
    };
  }

  const { facts, sourceMismatches } = selectWarehouseFacts(allFacts);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'warehouse-stock-facts:' + snapshotDate}))`,
    );
    await tx.delete(warehouseStockFacts).where(eq(warehouseStockFacts.snapshotDate, snapshotDate));

    const values = facts.map((fact) => ({
      snapshotDate,
      skuId: fact.skuId,
      skuCode: fact.skuCode,
      warehouseRaw: fact.warehouseRaw,
      warehouseCode: fact.warehouseCode,
      mapped: fact.mapped,
      bucket: fact.bucket,
      bucketName: fact.bucketName,
      qty: fact.qty,
      source: fact.source,
      selected: fact.selected,
      columnName: fact.columnName,
    }));

    for (const chunk of chunkRowsForInsert(values, 500)) {
      await tx.insert(warehouseStockFacts).values(chunk);
    }
  });

  return {
    snapshotDate,
    queryRows,
    chainRows,
    factCount: facts.length,
    selectedCount: facts.filter((f) => f.selected).length,
    unmatchedQueryColumns,
    unmatchedChainColumns,
    sourceMismatchCount: sourceMismatches.length,
    skippedSources,
  };
}
