import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  db,
  inventoryDataIssues,
  inventorySupplyLots,
  salesHistory,
  skus,
  warehouseStockFacts,
  warehouses,
} from '@scm/db';
import { chunkRowsForInsert } from './inventory-health-store.js';
import {
  planDataIssueUpsert,
  type DataIssueCandidate,
} from './inventory-data-issues.js';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import {
  resolveFulfillmentRegion,
  resolveSalesRegion,
  loadRegionMappingTables,
  type RegionMappingTables,
} from './region-mapping.js';

export const UNMAPPED_STATION_FP_PREFIX = 'unmapped_station:';
export const UNMAPPED_WAREHOUSE_FP_PREFIX = 'fulfillment_region_unmapped:';
/** 30 天窗口包含在 90 天内，扫描按近 90 天出货/库存取未映射键。 */
export const UNMAPPED_LOOKBACK_DAYS = 90;

export type UnmappedRegionHit = {
  key: string;
  skuId: string;
  qty: number;
};

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildUnmappedRegionCandidates(input: {
  stations: UnmappedRegionHit[];
  warehouses: UnmappedRegionHit[];
  tables: RegionMappingTables;
}): DataIssueCandidate[] {
  const issues: DataIssueCandidate[] = [];

  const stations = new Map<string, UnmappedRegionHit>();
  for (const hit of input.stations) {
    const key = hit.key.trim();
    if (!key || !hit.skuId) continue;
    const prev = stations.get(key);
    if (!prev) stations.set(key, { key, skuId: hit.skuId, qty: hit.qty });
    else prev.qty += hit.qty;
  }
  for (const hit of [...stations.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh'))) {
    if (resolveSalesRegion(hit.key, input.tables) !== 'UNMAPPED') continue;
    issues.push({
      fingerprint: `${UNMAPPED_STATION_FP_PREFIX}${hit.key}`,
      skuId: hit.skuId,
      warehouseCode: hit.key.slice(0, 100),
      issueType: 'unmapped_station',
      impactModule: 'planning',
      example: `站点「${hit.key}」近 ${UNMAPPED_LOOKBACK_DAYS} 天销量 ${hit.qty}，未配置销售区域`,
      qty: hit.qty,
    });
  }

  const warehouseHits = new Map<string, UnmappedRegionHit>();
  for (const hit of input.warehouses) {
    const key = hit.key.trim();
    if (!key || !hit.skuId) continue;
    const prev = warehouseHits.get(key);
    if (!prev) warehouseHits.set(key, { key, skuId: hit.skuId, qty: hit.qty });
    else {
      prev.qty += hit.qty;
      if (!prev.skuId) prev.skuId = hit.skuId;
    }
  }
  for (const hit of [...warehouseHits.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh'))) {
    if (resolveFulfillmentRegion(hit.key, input.tables) !== 'UNMAPPED') continue;
    issues.push({
      fingerprint: `${UNMAPPED_WAREHOUSE_FP_PREFIX}${hit.key}`,
      skuId: hit.skuId,
      warehouseCode: hit.key.slice(0, 100),
      issueType: 'unmapped_warehouse',
      impactModule: 'planning',
      example: `仓库「${hit.key}」未配置履约区域，近 ${UNMAPPED_LOOKBACK_DAYS} 天相关数量 ${hit.qty}`,
      qty: hit.qty,
    });
  }

  return issues;
}

async function loadUnmappedHits(since: string): Promise<{
  stations: UnmappedRegionHit[];
  warehouses: UnmappedRegionHit[];
}> {
  const stationRows = await db
    .select({
      key: salesHistory.station,
      qty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
      skuId: sql<string>`(array_agg(${salesHistory.skuId} ORDER BY ${salesHistory.qtySold} DESC))[1]::text`,
    })
    .from(salesHistory)
    .where(and(gte(salesHistory.saleDate, since), sql`btrim(${salesHistory.station}) <> ''`))
    .groupBy(salesHistory.station);

  const [activeWarehouses, lotRows, factRows, salesWarehouseRows, anchor] = await Promise.all([
    db
      .select({ code: warehouses.code })
      .from(warehouses)
      .where(eq(warehouses.isActive, true)),
    db
      .select({
        code: inventorySupplyLots.warehouseCode,
        qty: sql<number>`coalesce(sum(${inventorySupplyLots.qty}), 0)::int`,
        skuId: sql<string>`(array_agg(${inventorySupplyLots.skuId} ORDER BY ${inventorySupplyLots.qty} DESC))[1]::text`,
      })
      .from(inventorySupplyLots)
      .where(
        and(
          eq(inventorySupplyLots.status, 'open'),
          sql`btrim(${inventorySupplyLots.warehouseCode}) <> ''`,
        ),
      )
      .groupBy(inventorySupplyLots.warehouseCode),
    db
      .select({
        code: warehouseStockFacts.warehouseCode,
        qty: sql<number>`coalesce(sum(${warehouseStockFacts.qty}), 0)::int`,
        skuId: sql<string | null>`(array_agg(${warehouseStockFacts.skuId} ORDER BY ${warehouseStockFacts.qty} DESC) FILTER (WHERE ${warehouseStockFacts.skuId} IS NOT NULL))[1]::text`,
      })
      .from(warehouseStockFacts)
      .where(
        and(
          gte(warehouseStockFacts.snapshotDate, since),
          sql`${warehouseStockFacts.qty} > 0`,
          sql`btrim(${warehouseStockFacts.warehouseCode}) <> ''`,
        ),
      )
      .groupBy(warehouseStockFacts.warehouseCode),
    db
      .select({
        code: salesHistory.warehouseCode,
        qty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
        skuId: sql<string>`(array_agg(${salesHistory.skuId} ORDER BY ${salesHistory.qtySold} DESC))[1]::text`,
      })
      .from(salesHistory)
      .where(
        and(
          gte(salesHistory.saleDate, since),
          sql`${salesHistory.warehouseCode} IS NOT NULL`,
          sql`btrim(${salesHistory.warehouseCode}) <> ''`,
        ),
      )
      .groupBy(salesHistory.warehouseCode),
    db.select({ id: skus.id }).from(skus).limit(1),
  ]);

  const anchorSkuId = anchor[0]?.id ?? '';
  const warehousesByCode = new Map<string, UnmappedRegionHit>();
  const remember = (code: string | null, skuId: string | null | undefined, qty: number) => {
    const key = code?.trim() ?? '';
    if (!key) return;
    const resolvedSku = skuId?.trim() || anchorSkuId;
    if (!resolvedSku) return;
    const prev = warehousesByCode.get(key);
    if (!prev) {
      warehousesByCode.set(key, { key, skuId: resolvedSku, qty });
      return;
    }
    prev.qty += qty;
    if (skuId?.trim()) prev.skuId = skuId.trim();
  };

  for (const row of activeWarehouses) remember(row.code, anchorSkuId, 0);
  for (const row of lotRows) remember(row.code, row.skuId, Number(row.qty ?? 0));
  for (const row of factRows) remember(row.code, row.skuId, Number(row.qty ?? 0));
  for (const row of salesWarehouseRows) remember(row.code, row.skuId, Number(row.qty ?? 0));

  return {
    stations: stationRows.map((row) => ({
      key: row.key,
      skuId: row.skuId,
      qty: Number(row.qty ?? 0),
    })),
    warehouses: [...warehousesByCode.values()],
  };
}

async function upsertUnmappedRegionCandidates(detected: DataIssueCandidate[]): Promise<void> {
  const existing = await db
    .select({
      id: inventoryDataIssues.id,
      fingerprint: inventoryDataIssues.fingerprint,
      status: inventoryDataIssues.status,
    })
    .from(inventoryDataIssues)
    .where(
      and(
        inArray(inventoryDataIssues.status, ['open', 'in_progress', 'dismissed']),
        or(
          sql`${inventoryDataIssues.fingerprint} LIKE ${`${UNMAPPED_STATION_FP_PREFIX}%`}`,
          sql`${inventoryDataIssues.fingerprint} LIKE ${`${UNMAPPED_WAREHOUSE_FP_PREFIX}%`}`,
        ),
      ),
    );

  const plan = planDataIssueUpsert({ existing, detected });
  const now = new Date();
  if (plan.insert.length) {
    const values = plan.insert.map((row) => ({
      fingerprint: row.fingerprint,
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      issueType: row.issueType,
      impactModule: row.impactModule,
      example: row.example,
      qty: row.qty,
      lastSeenAt: now,
      updatedAt: now,
    }));
    for (const chunk of chunkRowsForInsert(values, 200)) {
      await db.insert(inventoryDataIssues).values(chunk);
    }
  }
  for (const row of plan.refresh) {
    await db
      .update(inventoryDataIssues)
      .set({
        example: row.candidate.example,
        qty: row.candidate.qty,
        impactModule: row.candidate.impactModule,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(inventoryDataIssues.id, row.id));
  }
  if (plan.autoResolve.length) {
    await db
      .update(inventoryDataIssues)
      .set({
        status: 'resolved',
        resolutionNote: 'scan_cleared',
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        inArray(
          inventoryDataIssues.id,
          plan.autoResolve.map((row) => row.id),
        ),
      );
  }
}

export async function collectUnmappedRegionCandidates(
  now: Date = new Date(),
): Promise<DataIssueCandidate[]> {
  const since = shiftIsoDate(getShanghaiBusinessDate(now), -UNMAPPED_LOOKBACK_DAYS);
  const [tables, hits] = await Promise.all([
    loadRegionMappingTables(db),
    loadUnmappedHits(since),
  ]);
  return buildUnmappedRegionCandidates({ ...hits, tables });
}

export async function runUnmappedRegionScan(): Promise<{
  stationIssues: number;
  warehouseIssues: number;
}> {
  try {
    const candidates = await collectUnmappedRegionCandidates();
    await upsertUnmappedRegionCandidates(candidates);
    return {
      stationIssues: candidates.filter((row) => row.issueType === 'unmapped_station').length,
      warehouseIssues: candidates.filter((row) => row.issueType === 'unmapped_warehouse').length,
    };
  } catch (err) {
    console.error('[region-unmapped-scan]', err);
    return { stationIssues: 0, warehouseIssues: 0 };
  }
}
