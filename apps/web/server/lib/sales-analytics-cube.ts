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

type CubeAccState = {
  monthSet: Set<string>;
  weekSet: Set<string>;
  entities: Map<string, EntityAcc>;
  totalSales: number;
  dateStart: string | null;
  dateEnd: string | null;
  recordCount: number;
};

function createCubeAccumulator(): CubeAccState {
  return {
    monthSet: new Set(),
    weekSet: new Set(),
    entities: new Map(),
    totalSales: 0,
    dateStart: null,
    dateEnd: null,
    recordCount: 0,
  };
}

/** Incremental path used by rebuild (page-by-page) and by accumulateCubeRows. */
function accumulateCubeRowsInto(
  state: CubeAccState,
  rows: CubeSourceRow[],
  warehouseStationByCode: Map<string, string>,
  platformNameByCode: Map<string, string>,
): void {
  state.recordCount += rows.length;

  for (const row of rows) {
    const saleDate = String(row.saleDate ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) continue;

    const qty = Number(row.qtySold);
    const safeQty = Number.isFinite(qty) ? qty : 0;
    state.totalSales += safeQty;

    if (!state.dateStart || saleDate < state.dateStart) state.dateStart = saleDate;
    if (!state.dateEnd || saleDate > state.dateEnd) state.dateEnd = saleDate;

    const month = saleDate.slice(0, 7);
    state.monthSet.add(month);
    const week = isoWeekLabel(saleDate);
    if (week) state.weekSet.add(week);

    const wh = (row.warehouseCode ?? '').trim();
    const station = wh ? warehouseStationByCode.get(wh) : null;
    const s = bucketAnalyticsSite(station);
    const b = extractAnalyticsDept(row.category);
    const c = extractAnalyticsCategoryLeaf(row.category);
    const p = platformDisplayName(row.channel, platformNameByCode);

    const key = dimKey(s, b, c, p);
    let ent = state.entities.get(key);
    if (!ent) {
      ent = { s, b, c, p, monthQty: new Map(), weekQty: new Map() };
      state.entities.set(key, ent);
    }
    ent.monthQty.set(month, (ent.monthQty.get(month) ?? 0) + safeQty);
    if (week) ent.weekQty.set(week, (ent.weekQty.get(week) ?? 0) + safeQty);
  }
}

function finalizeCubeAccumulator(state: CubeAccState): SalesAnalyticsCubePayload {
  const months = Array.from(state.monthSet).sort();
  const weeks = Array.from(state.weekSet).sort();

  const data = Array.from(state.entities.values()).map((ent) => ({
    s: ent.s,
    b: ent.b,
    c: ent.c,
    p: ent.p,
    v: months.map((m) => ent.monthQty.get(m) ?? 0),
    vw: weeks.map((w) => ent.weekQty.get(w) ?? 0),
  }));

  const meta: SalesAnalyticsCubePayload['meta'] = {
    generatedAt: new Date().toISOString(),
    dateStart: state.dateStart,
    dateEnd: state.dateEnd,
    weekStart: weeks[0] ?? null,
    weekEnd: weeks.length ? weeks[weeks.length - 1]! : null,
    recordCount: state.recordCount,
    totalSales: state.totalSales,
    sites: uniqueSorted(data.map((d) => d.s)),
    depts: uniqueSorted(data.map((d) => d.b)),
    categories: uniqueSorted(data.map((d) => d.c)),
    platforms: uniqueSorted(data.map((d) => d.p)),
  };

  return { meta, months, weeks, data };
}

/** Pure aggregator: daily sales_history rows → month/week cube payload (no DB). */
export function accumulateCubeRows(
  rows: CubeSourceRow[],
  warehouseStationByCode: Map<string, string>,
  platformNameByCode: Map<string, string>,
): SalesAnalyticsCubePayload {
  const state = createCubeAccumulator();
  accumulateCubeRowsInto(state, rows, warehouseStationByCode, platformNameByCode);
  return finalizeCubeAccumulator(state);
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
        createdAt: salesAnalyticsCubeSnapshots.createdAt,
      })
      .from(salesAnalyticsCubeSnapshots)
      .where(eq(salesAnalyticsCubeSnapshots.status, 'ready'))
      .orderBy(desc(salesAnalyticsCubeSnapshots.generatedAt))
      .limit(1),
    db
      .select({
        errorMessage: salesAnalyticsCubeSnapshots.errorMessage,
        createdAt: salesAnalyticsCubeSnapshots.createdAt,
      })
      .from(salesAnalyticsCubeSnapshots)
      .where(eq(salesAnalyticsCubeSnapshots.status, 'failed'))
      .orderBy(desc(salesAnalyticsCubeSnapshots.createdAt))
      .limit(1),
  ]);

  // Surface failure only when it is newer than the latest ready cube (or no ready exists).
  const showFailed =
    Boolean(failed?.errorMessage) &&
    (!ready?.createdAt || (failed!.createdAt != null && failed!.createdAt > ready.createdAt));

  return {
    running: Boolean(running),
    generatedAt: ready?.generatedAt ? ready.generatedAt.toISOString() : null,
    meta: ready?.meta ?? null,
    errorMessage: showFailed ? (failed?.errorMessage ?? null) : null,
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

async function accumulateSalesHistoryPages(
  warehouseStationByCode: Map<string, string>,
  platformNameByCode: Map<string, string>,
): Promise<SalesAnalyticsCubePayload> {
  const state = createCubeAccumulator();
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

    const page: CubeSourceRow[] = batch.map((row) => ({
      saleDate: String(row.saleDate).slice(0, 10),
      qtySold: Number(row.qtySold) || 0,
      warehouseCode: row.warehouseCode,
      channel: row.channel,
      category: row.category,
    }));
    accumulateCubeRowsInto(state, page, warehouseStationByCode, platformNameByCode);

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < HISTORY_PAGE_SIZE) break;
  }

  return finalizeCubeAccumulator(state);
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
    const [stationMap, nameMap] = await Promise.all([
      loadWarehouseStationMap(),
      loadPlatformNameMap(),
    ]);

    const payload = await accumulateSalesHistoryPages(stationMap, nameMap);
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

/** Fire-and-forget after sales import; 409 conflict (already running) is ignored. */
export function schedulePostImportSalesAnalyticsCubeRebuild(): void {
  void rebuildSalesAnalyticsCube(null).catch((err) => {
    console.warn('[sales-analytics] post-import rebuild failed', err);
  });
}
