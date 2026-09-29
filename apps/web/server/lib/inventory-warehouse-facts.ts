import { TURNOVER_BUCKET_WAREHOUSE_MAP } from './turnover-bucket-warehouse.js';

export const WAREHOUSE_FACT_BUCKETS = [
  'on_hand',
  'transfer_transit',
  'allocated_not_shipped',
  'eta_bucket',
] as const;

export type WarehouseFactBucket = (typeof WAREHOUSE_FACT_BUCKETS)[number];

export const WAREHOUSE_FACT_SOURCES = ['inventory_query', 'full_chain'] as const;

export type WarehouseFactSource = (typeof WAREHOUSE_FACT_SOURCES)[number];

/** 列名前缀 → 状态桶（长者优先匹配） */
export const WAREHOUSE_FACT_COLUMN_PREFIXES: ReadonlyArray<{
  prefix: string;
  bucket: WarehouseFactBucket;
}> = [
  { prefix: '已调拨未在途_', bucket: 'allocated_not_shipped' },
  { prefix: '预计10-20天上架_', bucket: 'eta_bucket' },
  { prefix: '预计超20天上架_', bucket: 'eta_bucket' },
  { prefix: '预计10天上架_', bucket: 'eta_bucket' },
  { prefix: '海外仓库存_', bucket: 'on_hand' },
  { prefix: '调拨在途_', bucket: 'transfer_transit' },
];

export const POSITION_MISMATCH_QTY_FLOOR = 20;
export const POSITION_MISMATCH_RATIO = 0.15;

export type WarehouseFactRow = {
  skuCode: string;
  skuId: string | null;
  warehouseRaw: string;
  warehouseCode: string;
  mapped: boolean;
  bucket: WarehouseFactBucket;
  bucketName: string;
  qty: number;
  source: WarehouseFactSource;
  selected: boolean;
  columnName: string;
};

export type ParsedWarehouseColumn = {
  prefix: string;
  bucket: WarehouseFactBucket;
  warehouseRaw: string;
  warehouseCode: string;
  mapped: boolean;
  bucketName: string;
};

function parseQty(value: unknown): number {
  const parsed = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWarehouseFactColumn(columnName: string): ParsedWarehouseColumn | null {
  const name = columnName.trim();
  if (!name) return null;

  for (const { prefix, bucket } of WAREHOUSE_FACT_COLUMN_PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    const warehouseRaw = name.slice(prefix.length).trim();
    if (!warehouseRaw || warehouseRaw === '合计') return null;
    const mappedCode = TURNOVER_BUCKET_WAREHOUSE_MAP[warehouseRaw];
    return {
      prefix,
      bucket,
      warehouseRaw,
      warehouseCode: mappedCode ?? warehouseRaw,
      mapped: Boolean(mappedCode),
      bucketName: prefix.replace(/_$/, ''),
    };
  }
  return null;
}

export function extractWarehouseFactsFromPayload(params: {
  skuCode: string;
  skuId?: string | null;
  source: WarehouseFactSource;
  payload: Record<string, unknown>;
  columns?: readonly string[];
}): { facts: WarehouseFactRow[]; unmatchedQtyColumns: string[] } {
  const skuCode = params.skuCode.trim();
  if (!skuCode) return { facts: [], unmatchedQtyColumns: [] };

  const keys = params.columns?.length
    ? [...params.columns]
    : Object.keys(params.payload);

  const facts: WarehouseFactRow[] = [];
  const unmatchedQtyColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const columnName of keys) {
    const trimmed = columnName.trim();
    if (!trimmed || seenColumns.has(trimmed)) continue;
    seenColumns.add(trimmed);

    const parsed = parseWarehouseFactColumn(trimmed);
    if (!parsed) {
      const qty = parseQty(params.payload[trimmed]);
      if (
        qty !== 0 &&
        (trimmed.includes('在途') || trimmed.includes('在库') || trimmed.includes('库存'))
      ) {
        unmatchedQtyColumns.push(trimmed);
      }
      continue;
    }

    const qty = parseQty(params.payload[trimmed]);
    if (qty === 0 && String(params.payload[trimmed] ?? '').trim() === '') continue;

    facts.push({
      skuCode,
      skuId: params.skuId ?? null,
      warehouseRaw: parsed.warehouseRaw,
      warehouseCode: parsed.warehouseCode,
      mapped: parsed.mapped,
      bucket: parsed.bucket,
      bucketName: parsed.bucketName,
      qty,
      source: params.source,
      selected: false,
      columnName: trimmed,
    });
  }

  return { facts, unmatchedQtyColumns };
}

/** 同一 SKU×仓×状态×来源：多行（如按销售国家）数量相加 */
export function aggregateWarehouseFacts(facts: WarehouseFactRow[]): WarehouseFactRow[] {
  const map = new Map<string, WarehouseFactRow>();
  for (const fact of facts) {
    const key = [
      fact.skuCode,
      fact.warehouseRaw,
      fact.bucket,
      fact.source,
      fact.bucketName,
    ].join('\0');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...fact });
      continue;
    }
    existing.qty += fact.qty;
    if (!existing.skuId && fact.skuId) existing.skuId = fact.skuId;
  }
  return Array.from(map.values());
}

export function preferredSourceForBucket(bucket: WarehouseFactBucket): WarehouseFactSource {
  if (bucket === 'on_hand') return 'full_chain';
  return 'inventory_query';
}

export function exceedsPositionMismatchThreshold(a: number, b: number): boolean {
  const left = Math.max(0, a);
  const right = Math.max(0, b);
  const delta = Math.abs(left - right);
  if (delta === 0) return false;
  const larger = Math.max(left, right, 1);
  return delta > POSITION_MISMATCH_QTY_FLOOR || delta / larger > POSITION_MISMATCH_RATIO;
}

export type WarehouseFactSelectResult = {
  facts: WarehouseFactRow[];
  sourceMismatches: Array<{
    skuCode: string;
    skuId: string | null;
    warehouseCode: string;
    warehouseRaw: string;
    bucket: WarehouseFactBucket;
    queryQty: number;
    chainQty: number;
  }>;
};

/**
 * 两源择优：在库优先全链；调拨在途 / 已调拨未在途 / 预计上架优先查询。
 * 仅一方有数时该方 selected；双方都有且超阈值时仍选优先源，并记录 mismatch。
 */
export function selectWarehouseFacts(facts: WarehouseFactRow[]): WarehouseFactSelectResult {
  const aggregated = aggregateWarehouseFacts(facts);
  const groups = new Map<string, WarehouseFactRow[]>();

  for (const fact of aggregated) {
    const key = [fact.skuCode, fact.warehouseRaw, fact.bucket, fact.bucketName].join('\0');
    const list = groups.get(key) ?? [];
    list.push(fact);
    groups.set(key, list);
  }

  const selectedFacts: WarehouseFactRow[] = [];
  const sourceMismatches: WarehouseFactSelectResult['sourceMismatches'] = [];

  for (const group of groups.values()) {
    const preferred = preferredSourceForBucket(group[0]!.bucket);
    const bySource = new Map(group.map((row) => [row.source, row]));
    const query = bySource.get('inventory_query');
    const chain = bySource.get('full_chain');

    let winner: WarehouseFactRow | undefined = bySource.get(preferred);
    if (!winner) winner = query ?? chain;
    if (!winner) continue;

    if (query && chain && exceedsPositionMismatchThreshold(query.qty, chain.qty)) {
      sourceMismatches.push({
        skuCode: winner.skuCode,
        skuId: winner.skuId ?? query.skuId ?? chain.skuId,
        warehouseCode: winner.warehouseCode,
        warehouseRaw: winner.warehouseRaw,
        bucket: winner.bucket,
        queryQty: query.qty,
        chainQty: chain.qty,
      });
    }

    for (const row of group) {
      selectedFacts.push({
        ...row,
        selected: row.source === winner.source && row.bucketName === winner.bucketName,
      });
    }
  }

  return { facts: selectedFacts, sourceMismatches };
}

export function selectedOnHandByWarehouse(
  facts: WarehouseFactRow[],
): Map<string, Map<string, number>> {
  const bySku = new Map<string, Map<string, number>>();
  for (const fact of facts) {
    if (!fact.selected || fact.bucket !== 'on_hand') continue;
    const wh = bySku.get(fact.skuCode) ?? new Map<string, number>();
    wh.set(fact.warehouseCode, (wh.get(fact.warehouseCode) ?? 0) + fact.qty);
    bySku.set(fact.skuCode, wh);
  }
  return bySku;
}

export function selectedTransitByWarehouse(
  facts: WarehouseFactRow[],
): Map<string, Map<string, number>> {
  const bySku = new Map<string, Map<string, number>>();
  for (const fact of facts) {
    if (!fact.selected || fact.bucket !== 'transfer_transit') continue;
    const wh = bySku.get(fact.skuCode) ?? new Map<string, number>();
    wh.set(fact.warehouseCode, (wh.get(fact.warehouseCode) ?? 0) + fact.qty);
    bySku.set(fact.skuCode, wh);
  }
  return bySku;
}
