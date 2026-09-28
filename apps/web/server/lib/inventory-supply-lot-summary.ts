import { and, desc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, inventorySupplyLots, skus } from '@scm/db';
import { buildCsv } from './csv-export.js';

export type SupplyLotSummaryFilters = {
  q?: string;
  warehouse?: string;
  hasOverseas?: boolean;
  hasInTransit?: boolean;
  hasLocal?: boolean;
  hasUndatedTransit?: boolean;
  multiTransitBatch?: boolean;
};

export type SupplyLotSummaryLotInput = {
  skuId: string;
  warehouseCode: string;
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  availableAt: string | null;
  dateUnknown: boolean;
  etaEstimated: boolean;
};

export type SupplyLotSummaryRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string;
  overseasQty: number;
  inTransitQty: number;
  localQty: number;
  undatedTransitQty: number;
  inTransitBatchCount: number;
  localBatchCount: number;
  overseasBatchCount: number;
  nextTransitAt: string | null;
  nextTransitQty: number;
  nextTransitEstimated: boolean;
  nextLocalAt: string | null;
  nextLocalQty: number;
  batchCount: number;
  updatedAt: string;
};

const SUMMARY_EXPORT_HEADERS = [
  'SKU',
  'SKU名称',
  '目的仓',
  '本地',
  '在库',
  '在途',
  '无期在途',
  '最近到货日',
  '最近到货数量',
  '最近到货是否估期',
] as const;

function summaryKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
}

function isUndatedTransit(lot: SupplyLotSummaryLotInput) {
  return lot.pool === 'in_transit' && (lot.dateUnknown || lot.availableAt == null);
}

function pickNextArrival(lots: SupplyLotSummaryLotInput[]) {
  const dated = lots.filter((lot) => lot.availableAt && !lot.dateUnknown);
  if (!dated.length) {
    return { nextAt: null as string | null, nextQty: 0, nextEstimated: false };
  }
  const nextAt = dated.reduce(
    (min, lot) => (lot.availableAt! < min ? lot.availableAt! : min),
    dated[0].availableAt!,
  );
  const onDate = dated.filter((lot) => lot.availableAt === nextAt);
  const nextQty = onDate.reduce((sum, lot) => sum + lot.qty, 0);
  const nextEstimated = onDate.some((lot) => lot.etaEstimated);
  return { nextAt, nextQty, nextEstimated };
}

/** 从同一 SKU×目的仓的开放批次计算汇总字段（含在途最近到货）。 */
export function enrichSupplyLotSummary(
  base: Omit<
    SupplyLotSummaryRow,
    | 'undatedTransitQty'
    | 'inTransitBatchCount'
    | 'localBatchCount'
    | 'overseasBatchCount'
    | 'nextTransitAt'
    | 'nextTransitQty'
    | 'nextTransitEstimated'
    | 'nextLocalAt'
    | 'nextLocalQty'
    | 'batchCount'
  >,
  lots: SupplyLotSummaryLotInput[],
): SupplyLotSummaryRow {
  const inTransitLots = lots.filter((lot) => lot.pool === 'in_transit');
  const localLots = lots.filter((lot) => lot.pool === 'local');
  const overseasLots = lots.filter((lot) => lot.pool === 'overseas');
  const nextTransit = pickNextArrival(inTransitLots);
  const nextLocal = pickNextArrival(localLots);

  return {
    ...base,
    undatedTransitQty: inTransitLots
      .filter(isUndatedTransit)
      .reduce((sum, lot) => sum + lot.qty, 0),
    inTransitBatchCount: inTransitLots.length,
    localBatchCount: localLots.length,
    overseasBatchCount: overseasLots.length,
    nextTransitAt: nextTransit.nextAt,
    nextTransitQty: nextTransit.nextQty,
    nextTransitEstimated: nextTransit.nextEstimated,
    nextLocalAt: nextLocal.nextAt,
    nextLocalQty: nextLocal.nextQty,
    batchCount: lots.length,
  };
}

export function parseSupplyLotSummaryFilters(query: Record<string, string | undefined>): SupplyLotSummaryFilters {
  const flag = (value: string | undefined) => (value === 'true' ? true : undefined);
  return {
    q: query.q?.trim() || undefined,
    warehouse: query.warehouse?.trim() || undefined,
    hasOverseas: flag(query.hasOverseas),
    hasInTransit: flag(query.hasInTransit),
    hasLocal: flag(query.hasLocal),
    hasUndatedTransit: flag(query.hasUndatedTransit),
    multiTransitBatch: flag(query.multiTransitBatch),
  };
}

function buildSummarySearchConditions(params: Pick<SupplyLotSummaryFilters, 'q' | 'warehouse'>) {
  const conditions: SQL[] = [eq(inventorySupplyLots.status, 'open')];
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(inventorySupplyLots.warehouseCode, pattern),
        ilike(inventorySupplyLots.factoryCode, pattern),
      )!,
    );
  }
  if (params.warehouse) {
    conditions.push(eq(inventorySupplyLots.warehouseCode, params.warehouse));
  }
  return and(...conditions);
}

function buildSummaryHavingClause(params: SupplyLotSummaryFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (params.hasOverseas) {
    parts.push(
      sql`coalesce(sum(case when ${inventorySupplyLots.pool} = 'overseas' then ${inventorySupplyLots.qty} else 0 end), 0) > 0`,
    );
  }
  if (params.hasInTransit) {
    parts.push(
      sql`coalesce(sum(case when ${inventorySupplyLots.pool} = 'in_transit' then ${inventorySupplyLots.qty} else 0 end), 0) > 0`,
    );
  }
  if (params.hasLocal) {
    parts.push(
      sql`coalesce(sum(case when ${inventorySupplyLots.pool} = 'local' then ${inventorySupplyLots.qty} else 0 end), 0) > 0`,
    );
  }
  if (params.hasUndatedTransit) {
    parts.push(
      sql`coalesce(sum(case when ${inventorySupplyLots.pool} = 'in_transit' and (${inventorySupplyLots.dateUnknown} = true or ${inventorySupplyLots.availableAt} is null) then ${inventorySupplyLots.qty} else 0 end), 0) > 0`,
    );
  }
  if (params.multiTransitBatch) {
    parts.push(
      sql`count(case when ${inventorySupplyLots.pool} = 'in_transit' then 1 end) > 1`,
    );
  }
  if (!parts.length) return undefined;
  return sql.join(parts, sql` and `);
}

async function loadGroupedSummaries(params: {
  filters: SupplyLotSummaryFilters;
  limit?: number;
  offset?: number;
}) {
  const where = buildSummarySearchConditions(params.filters);
  const having = buildSummaryHavingClause(params.filters);

  let query = db
    .select({
      skuId: inventorySupplyLots.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: inventorySupplyLots.warehouseCode,
      overseasQty: sql<number>`coalesce(sum(case when ${inventorySupplyLots.pool} = 'overseas' then ${inventorySupplyLots.qty} else 0 end), 0)::int`,
      inTransitQty: sql<number>`coalesce(sum(case when ${inventorySupplyLots.pool} = 'in_transit' then ${inventorySupplyLots.qty} else 0 end), 0)::int`,
      localQty: sql<number>`coalesce(sum(case when ${inventorySupplyLots.pool} = 'local' then ${inventorySupplyLots.qty} else 0 end), 0)::int`,
      updatedAt: sql<string>`max(${inventorySupplyLots.updatedAt})::text`,
    })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where)
    .groupBy(
      inventorySupplyLots.skuId,
      skus.code,
      skus.name,
      inventorySupplyLots.warehouseCode,
    )
    .orderBy(desc(sql`max(${inventorySupplyLots.updatedAt})`));

  if (having) {
    query = query.having(having) as typeof query;
  }
  if (params.limit != null) {
    query = query.limit(params.limit) as typeof query;
  }
  if (params.offset != null) {
    query = query.offset(params.offset) as typeof query;
  }

  return query;
}

async function enrichGroupedSummaries(
  grouped: Awaited<ReturnType<typeof loadGroupedSummaries>>,
): Promise<SupplyLotSummaryRow[]> {
  if (!grouped.length) return [];

  const skuIds = [...new Set(grouped.map((row) => row.skuId))];
  const warehouseCodes = [...new Set(grouped.map((row) => row.warehouseCode))];
  const lotRows = await db
    .select({
      skuId: inventorySupplyLots.skuId,
      warehouseCode: inventorySupplyLots.warehouseCode,
      pool: inventorySupplyLots.pool,
      qty: inventorySupplyLots.qty,
      availableAt: inventorySupplyLots.availableAt,
      dateUnknown: inventorySupplyLots.dateUnknown,
      etaEstimated: inventorySupplyLots.etaEstimated,
    })
    .from(inventorySupplyLots)
    .where(
      and(
        eq(inventorySupplyLots.status, 'open'),
        inArray(inventorySupplyLots.skuId, skuIds),
        inArray(inventorySupplyLots.warehouseCode, warehouseCodes),
      ),
    );

  const lotsByKey = new Map<string, SupplyLotSummaryLotInput[]>();
  for (const lot of lotRows) {
    const key = summaryKey(lot.skuId, lot.warehouseCode);
    const bucket = lotsByKey.get(key) ?? [];
    bucket.push({
      skuId: lot.skuId,
      warehouseCode: lot.warehouseCode,
      pool: lot.pool as SupplyLotSummaryLotInput['pool'],
      qty: lot.qty,
      availableAt: lot.availableAt,
      dateUnknown: lot.dateUnknown,
      etaEstimated: lot.etaEstimated,
    });
    lotsByKey.set(key, bucket);
  }

  return grouped.map((row) =>
    enrichSupplyLotSummary(
      {
        skuId: row.skuId,
        skuCode: row.skuCode,
        skuName: row.skuName,
        warehouseCode: row.warehouseCode,
        overseasQty: Number(row.overseasQty ?? 0),
        inTransitQty: Number(row.inTransitQty ?? 0),
        localQty: Number(row.localQty ?? 0),
        updatedAt: row.updatedAt,
      },
      lotsByKey.get(summaryKey(row.skuId, row.warehouseCode)) ?? [],
    ),
  );
}

export async function countSupplyLotSummaries(params: SupplyLotSummaryFilters) {
  const where = buildSummarySearchConditions(params);
  const having = buildSummaryHavingClause(params);
  if (!having) {
    const [row] = await db
      .select({
        count: sql<number>`count(distinct (${inventorySupplyLots.skuId}, ${inventorySupplyLots.warehouseCode}))::int`,
      })
      .from(inventorySupplyLots)
      .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
      .where(where);
    return Number(row?.count ?? 0);
  }

  const grouped = db
    .select({
      skuId: inventorySupplyLots.skuId,
      warehouseCode: inventorySupplyLots.warehouseCode,
    })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where)
    .groupBy(inventorySupplyLots.skuId, inventorySupplyLots.warehouseCode)
    .having(having)
    .as('grouped_summaries');

  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(grouped);
  return Number(row?.count ?? 0);
}

export async function listSupplyLotSummaries(params: {
  limit?: number;
  offset?: number;
} & SupplyLotSummaryFilters): Promise<SupplyLotSummaryRow[]> {
  const grouped = await loadGroupedSummaries({
    filters: params,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  });
  return enrichGroupedSummaries(grouped);
}

export async function listAllSupplyLotSummaries(
  filters: SupplyLotSummaryFilters,
): Promise<SupplyLotSummaryRow[]> {
  const grouped = await loadGroupedSummaries({ filters });
  return enrichGroupedSummaries(grouped);
}

export function summaryRowToCsvRow(row: SupplyLotSummaryRow) {
  return [
    row.skuCode,
    row.skuName,
    row.warehouseCode,
    row.localQty,
    row.overseasQty,
    row.inTransitQty,
    row.undatedTransitQty || '',
    row.nextTransitAt ?? '',
    row.nextTransitQty || '',
    row.nextTransitEstimated ? '是' : row.nextTransitAt ? '否' : '',
  ];
}

export async function buildSupplyLotSummaryExportCsv(filters: SupplyLotSummaryFilters) {
  const rows = await listAllSupplyLotSummaries(filters);
  return buildCsv([...SUMMARY_EXPORT_HEADERS], rows.map(summaryRowToCsvRow));
}

export async function listSupplyLotWarehouseOptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ warehouseCode: inventorySupplyLots.warehouseCode })
    .from(inventorySupplyLots)
    .where(
      and(eq(inventorySupplyLots.status, 'open'), gt(inventorySupplyLots.qty, 0)),
    )
    .orderBy(inventorySupplyLots.warehouseCode);
  return rows.map((row) => row.warehouseCode);
}
