import { desc, eq, gt, notInArray, sql } from 'drizzle-orm';
import {
  db,
  salesAnalyticsCubeSnapshots,
  salesHistory,
  salesPlatforms,
  skus,
  warehouses,
  type SalesAnalyticsCubePayload,
} from '@scm/db';
import { stationForWarehouse } from './forecast-demand.js';
import { normalizeSalesPlatformSync } from './sales-platform.js';
import {
  bucketAnalyticsSite,
  extractAnalyticsCategoryLeaf,
  extractAnalyticsDept,
  isoWeekLabel,
} from './sales-analytics-dims.js';

export type CubeSourceRow = {
  saleDate: string;
  qtySold: number;
  warehouseCode?: string | null;
  channel?: string | null;
  category?: string | null;
};

type EntityAcc = {
  s: string;
  b: string;
  c: string;
  p: string;
  monthQty: Map<string, number>;
  weekQty: Map<string, number>;
};

const HISTORY_PAGE_SIZE = 5_000;
const SNAPSHOT_KEEP = 5;

function dimKey(s: string, b: string, c: string, p: string): string {
  return `${s}\0${b}\0${c}\0${p}`;
}

function platformDisplayName(
  channel: string | null | undefined,
  platformNameByCode: Map<string, string>,
): string {
  const code = normalizeSalesPlatformSync(channel);
  if (code === 'UNKNOWN') return '(未标注平台)';
  return platformNameByCode.get(code) ?? code;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** Pure aggregator: daily sales_history rows → month/week cube payload (no DB). */
export function accumulateCubeRows(
  rows: CubeSourceRow[],
  warehouseStationByCode: Map<string, string>,
  platformNameByCode: Map<string, string>,
): SalesAnalyticsCubePayload {
  const monthSet = new Set<string>();
  const weekSet = new Set<string>();
  const entities = new Map<string, EntityAcc>();
  let totalSales = 0;
  let dateStart: string | null = null;
  let dateEnd: string | null = null;

  for (const row of rows) {
    const saleDate = String(row.saleDate ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) continue;

    const qty = Number(row.qtySold);
    const safeQty = Number.isFinite(qty) ? qty : 0;
    totalSales += safeQty;

    if (!dateStart || saleDate < dateStart) dateStart = saleDate;
    if (!dateEnd || saleDate > dateEnd) dateEnd = saleDate;

    const month = saleDate.slice(0, 7);
    monthSet.add(month);
    const week = isoWeekLabel(saleDate);
    if (week) weekSet.add(week);

    const wh = (row.warehouseCode ?? '').trim();
    const station = wh ? warehouseStationByCode.get(wh) : null;
    const s = bucketAnalyticsSite(station);
    const b = extractAnalyticsDept(row.category);
    const c = extractAnalyticsCategoryLeaf(row.category);
    const p = platformDisplayName(row.channel, platformNameByCode);

    const key = dimKey(s, b, c, p);
    let ent = entities.get(key);
    if (!ent) {
      ent = { s, b, c, p, monthQty: new Map(), weekQty: new Map() };
      entities.set(key, ent);
    }
    ent.monthQty.set(month, (ent.monthQty.get(month) ?? 0) + safeQty);
    if (week) ent.weekQty.set(week, (ent.weekQty.get(week) ?? 0) + safeQty);
  }

  const months = Array.from(monthSet).sort();
  const weeks = Array.from(weekSet).sort();

  const data = Array.from(entities.values()).map((ent) => ({
    s: ent.s,
    b: ent.b,
    c: ent.c,
    p: ent.p,
    v: months.map((m) => ent.monthQty.get(m) ?? 0),
    vw: weeks.map((w) => ent.weekQty.get(w) ?? 0),
  }));

  const meta: SalesAnalyticsCubePayload['meta'] = {
    generatedAt: new Date().toISOString(),
    dateStart,
    dateEnd,
    weekStart: weeks[0] ?? null,
    weekEnd: weeks.length ? weeks[weeks.length - 1]! : null,
    recordCount: rows.length,
    totalSales,
    sites: uniqueSorted(data.map((d) => d.s)),
    depts: uniqueSorted(data.map((d) => d.b)),
    categories: uniqueSorted(data.map((d) => d.c)),
    platforms: uniqueSorted(data.map((d) => d.p)),
  };

  return { meta, months, weeks, data };
}

export async function getLatestReadyCube(): Promise<SalesAnalyticsCubePayload | null> {
  const [row] = await db
    .select({ payload: salesAnalyticsCubeSnapshots.payload })
    .from(salesAnalyticsCubeSnapshots)
    .where(eq(salesAnalyticsCubeSnapshots.status, 'ready'))
    .orderBy(desc(salesAnalyticsCubeSnapshots.generatedAt))
    .limit(1);
  return row?.payload ?? null;
}

export async function getCubeStatus(): Promise<{
  running: boolean;
  generatedAt: string | null;
  meta: SalesAnalyticsCubePayload['meta'] | null;
  errorMessage: string | null;
}> {
  const [[running], [ready], [failed]] = await Promise.all([
    db
      .select({ id: salesAnalyticsCubeSnapshots.id })
      .from(salesAnalyticsCubeSnapshots)
      .where(eq(salesAnalyticsCubeSnapshots.status, 'running'))
      .limit(1),
    db
      .select({
        generatedAt: salesAnalyticsCubeSnapshots.generatedAt,
        meta: salesAnalyticsCubeSnapshots.meta,
      })
      .from(salesAnalyticsCubeSnapshots)
      .where(eq(salesAnalyticsCubeSnapshots.status, 'ready'))
      .orderBy(desc(salesAnalyticsCubeSnapshots.generatedAt))
      .limit(1),
    db
      .select({ errorMessage: salesAnalyticsCubeSnapshots.errorMessage })
      .from(salesAnalyticsCubeSnapshots)
      .where(eq(salesAnalyticsCubeSnapshots.status, 'failed'))
      .orderBy(desc(salesAnalyticsCubeSnapshots.createdAt))
      .limit(1),
  ]);

  return {
    running: Boolean(running),
    generatedAt: ready?.generatedAt ? ready.generatedAt.toISOString() : null,
    meta: ready?.meta ?? null,
    errorMessage: failed?.errorMessage ?? null,
  };
}

async function loadWarehouseStationMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.code, stationForWarehouse(row.regionGroup, row.countryCode));
  }
  return map;
}

async function loadPlatformNameMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ code: salesPlatforms.code, name: salesPlatforms.name })
    .from(salesPlatforms);
  return new Map(rows.map((r) => [r.code, r.name]));
}

async function loadSalesHistoryRows(): Promise<CubeSourceRow[]> {
  const out: CubeSourceRow[] = [];
  let cursor: string | null = null;

  for (;;) {
    const batch = await db
      .select({
        id: salesHistory.id,
        saleDate: salesHistory.saleDate,
        qtySold: salesHistory.qtySold,
        warehouseCode: salesHistory.warehouseCode,
        channel: salesHistory.channel,
        category: sql<string | null>`coalesce(${salesHistory.category}, ${skus.category})`,
      })
      .from(salesHistory)
      .leftJoin(skus, eq(skus.id, salesHistory.skuId))
      .where(cursor ? gt(salesHistory.id, cursor) : undefined)
      .orderBy(salesHistory.id)
      .limit(HISTORY_PAGE_SIZE);

    if (!batch.length) break;

    for (const row of batch) {
      out.push({
        saleDate: String(row.saleDate).slice(0, 10),
        qtySold: Number(row.qtySold) || 0,
        warehouseCode: row.warehouseCode,
        channel: row.channel,
        category: row.category,
      });
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < HISTORY_PAGE_SIZE) break;
  }

  return out;
}

async function pruneOldSnapshots(keep = SNAPSHOT_KEEP): Promise<void> {
  const kept = await db
    .select({ id: salesAnalyticsCubeSnapshots.id })
    .from(salesAnalyticsCubeSnapshots)
    .orderBy(desc(salesAnalyticsCubeSnapshots.createdAt))
    .limit(keep);
  if (!kept.length) return;
  const keepIds = kept.map((r) => r.id);
  await db
    .delete(salesAnalyticsCubeSnapshots)
    .where(notInArray(salesAnalyticsCubeSnapshots.id, keepIds));
}

export async function rebuildSalesAnalyticsCube(
  createdBy?: string | null,
): Promise<{ ok: true } | { ok: false; conflict: true } | { ok: false; error: string }> {
  const [existingRunning] = await db
    .select({ id: salesAnalyticsCubeSnapshots.id })
    .from(salesAnalyticsCubeSnapshots)
    .where(eq(salesAnalyticsCubeSnapshots.status, 'running'))
    .limit(1);
  if (existingRunning) return { ok: false, conflict: true };

  const [snap] = await db
    .insert(salesAnalyticsCubeSnapshots)
    .values({
      status: 'running',
      createdBy: createdBy ?? null,
    })
    .returning({ id: salesAnalyticsCubeSnapshots.id });

  if (!snap) return { ok: false, error: 'failed to create snapshot row' };

  try {
    const [stationMap, nameMap, rows] = await Promise.all([
      loadWarehouseStationMap(),
      loadPlatformNameMap(),
      loadSalesHistoryRows(),
    ]);

    const payload = accumulateCubeRows(rows, stationMap, nameMap);
    const generatedAt = new Date();
    payload.meta.generatedAt = generatedAt.toISOString();

    await db
      .update(salesAnalyticsCubeSnapshots)
      .set({
        status: 'ready',
        generatedAt,
        meta: payload.meta,
        payload,
        errorMessage: null,
      })
      .where(eq(salesAnalyticsCubeSnapshots.id, snap.id));

    await pruneOldSnapshots(SNAPSHOT_KEEP);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(salesAnalyticsCubeSnapshots)
      .set({
        status: 'failed',
        errorMessage: message,
      })
      .where(eq(salesAnalyticsCubeSnapshots.id, snap.id));
    return { ok: false, error: message };
  }
}
