import {
  allocateByShare,
  type ShareParseResult,
} from './inventory-share-allocation.js';
import {
  exceedsPositionMismatchThreshold,
  type WarehouseFactBucket,
} from './inventory-warehouse-facts.js';

export const DATA_ISSUE_TYPES = [
  'missing_available_at',
  'unallocated_warehouse',
  'share_sum_mismatch',
  'unmapped_warehouse',
  'position_source_mismatch',
  'position_share_gap',
] as const;

export type DataIssueType = (typeof DATA_ISSUE_TYPES)[number];

export type DataIssueImpact = 'timeline' | 'horizon' | 'planning';

export type DataIssueLot = {
  skuId: string;
  warehouseCode: string;
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  status: 'open' | 'consumed' | 'cancelled';
  dateUnknown: boolean;
  availableAt: string | null;
  source: string;
  sourceId: string | null;
};

export type DataIssueSku = {
  skuId: string;
  skuCode: string;
  overseasAvailable: number;
  share: ShareParseResult;
};

/** 影子长表对账输入（需已匹配本地 SKU） */
export type DataIssueWarehouseFact = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  warehouseRaw: string;
  mapped: boolean;
  bucket: WarehouseFactBucket;
  qty: number;
  source: 'inventory_query' | 'full_chain';
  selected: boolean;
};

export type DataIssueShareGapSku = {
  skuId: string;
  skuCode: string;
  overseasAvailable: number;
  share: ShareParseResult;
  /** warehouse_code → selected on_hand qty */
  factOnHandByWarehouse: Map<string, number>;
};

export type DataIssueCandidate = {
  fingerprint: string;
  skuId: string;
  warehouseCode: string;
  issueType: DataIssueType;
  impactModule: DataIssueImpact;
  example: string;
  qty: number;
};

const POOL_LABEL: Record<DataIssueLot['pool'], string> = {
  overseas: '海外',
  in_transit: '在途',
  local: '本地',
};

export function missingAvailableAtFingerprint(lot: DataIssueLot): string {
  return `missing_available_at:${lot.skuId}:${lot.warehouseCode}:${lot.source}:${lot.sourceId || 'none'}`;
}

export function detectInventoryDataIssues(input: {
  lots: DataIssueLot[];
  skus: DataIssueSku[];
  warehouseFacts?: DataIssueWarehouseFact[];
  shareGapSkus?: DataIssueShareGapSku[];
}): DataIssueCandidate[] {
  const issues: DataIssueCandidate[] = [];

  for (const row of input.lots) {
    if (row.status !== 'open' || row.qty <= 0) continue;
    if (!row.dateUnknown && row.availableAt) continue;
    issues.push({
      fingerprint: missingAvailableAtFingerprint(row),
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      issueType: 'missing_available_at',
      impactModule: 'timeline',
      example: `${POOL_LABEL[row.pool]} 批次 ${row.sourceId || 'none'} 缺可用日，不进时间轴`,
      qty: row.qty,
    });
  }

  for (const row of input.skus) {
    if (row.overseasAvailable > 0 && row.share.method === 'unallocated') {
      issues.push({
        fingerprint: `unallocated_warehouse:${row.skuId}:OVERSEAS`,
        skuId: row.skuId,
        warehouseCode: 'OVERSEAS',
        issueType: 'unallocated_warehouse',
        impactModule: 'horizon',
        example: `飞书无销售占比，海外在库 ${row.overseasAvailable} 停在 OVERSEAS，7/15/30 不可用`,
        qty: row.overseasAvailable,
      });
    }
    if (row.share.shareSumWarning) {
      issues.push({
        fingerprint: `share_sum_mismatch:${row.skuId}:OVERSEAS`,
        skuId: row.skuId,
        warehouseCode: 'OVERSEAS',
        issueType: 'share_sum_mismatch',
        impactModule: 'planning',
        example: `销售占比合计 ${row.share.shareSum}，已按相对权重拆仓`,
        qty: row.overseasAvailable,
      });
    }
  }

  issues.push(...detectWarehouseFactDataIssues(input.warehouseFacts ?? []));
  issues.push(...detectPositionShareGapIssues(input.shareGapSkus ?? []));

  return issues;
}

const BUCKET_LABEL: Record<WarehouseFactBucket, string> = {
  on_hand: '在库',
  transfer_transit: '调拨在途',
  allocated_not_shipped: '已调拨未在途',
  eta_bucket: '预计上架',
};

/** 未映射仓 + 查询/全链同仓同状态超阈值 */
export function detectWarehouseFactDataIssues(
  facts: DataIssueWarehouseFact[],
): DataIssueCandidate[] {
  const issues: DataIssueCandidate[] = [];
  const unmappedSeen = new Set<string>();
  const byKey = new Map<string, { query?: DataIssueWarehouseFact; chain?: DataIssueWarehouseFact }>();

  for (const fact of facts) {
    if (!fact.skuId || fact.qty <= 0) continue;

    if (!fact.mapped) {
      const fp = `unmapped_warehouse:${fact.skuId}:${fact.warehouseRaw}`;
      if (!unmappedSeen.has(fp)) {
        unmappedSeen.add(fp);
        issues.push({
          fingerprint: fp,
          skuId: fact.skuId,
          warehouseCode: fact.warehouseCode,
          issueType: 'unmapped_warehouse',
          impactModule: 'planning',
          example: `影子长表出现未映射仓「${fact.warehouseRaw}」，请在迅捷确认仓名并补映射`,
          qty: fact.qty,
        });
      }
    }

    const key = `${fact.skuId}\0${fact.warehouseRaw}\0${fact.bucket}`;
    const slot = byKey.get(key) ?? {};
    if (fact.source === 'inventory_query') slot.query = fact;
    else slot.chain = fact;
    byKey.set(key, slot);
  }

  for (const slot of byKey.values()) {
    const query = slot.query;
    const chain = slot.chain;
    if (!query || !chain) continue;
    if (!exceedsPositionMismatchThreshold(query.qty, chain.qty)) continue;
    const skuId = query.skuId;
    issues.push({
      fingerprint: `position_source_mismatch:${skuId}:${query.warehouseRaw}:${query.bucket}`,
      skuId,
      warehouseCode: query.warehouseCode,
      issueType: 'position_source_mismatch',
      impactModule: 'planning',
      example: `${BUCKET_LABEL[query.bucket]} 查询 ${query.qty} vs 全链 ${chain.qty}（仓 ${query.warehouseRaw}）`,
      qty: Math.abs(query.qty - chain.qty),
    });
  }

  return issues;
}

/** 长表在库 vs 周转合计 × 销售占比 */
export function detectPositionShareGapIssues(
  skus: DataIssueShareGapSku[],
): DataIssueCandidate[] {
  const issues: DataIssueCandidate[] = [];

  for (const row of skus) {
    if (row.overseasAvailable <= 0 || row.share.method !== 'sales_share') continue;
    const allocated = allocateByShare(row.overseasAvailable, row.share);
    const warehouses = new Set([
      ...allocated.keys(),
      ...row.factOnHandByWarehouse.keys(),
    ]);
    for (const warehouse of warehouses) {
      const shareQty = allocated.get(warehouse) ?? 0;
      const factQty = row.factOnHandByWarehouse.get(warehouse) ?? 0;
      if (!exceedsPositionMismatchThreshold(shareQty, factQty)) continue;
      issues.push({
        fingerprint: `position_share_gap:${row.skuId}:${warehouse}`,
        skuId: row.skuId,
        warehouseCode: warehouse,
        issueType: 'position_share_gap',
        impactModule: 'planning',
        example: `影子在库 ${factQty} vs 合计×占比 ${shareQty}（周转海外 ${row.overseasAvailable}）`,
        qty: Math.abs(factQty - shareQty),
      });
    }
  }

  return issues;
}

export type ExistingDataIssue = {
  id: string;
  fingerprint: string;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
};

export type DataIssueUpsertPlan = {
  insert: DataIssueCandidate[];
  refresh: Array<{ id: string; candidate: DataIssueCandidate }>;
  autoResolve: Array<{ id: string }>;
};

export function planDataIssueUpsert(input: {
  existing: ExistingDataIssue[];
  detected: DataIssueCandidate[];
}): DataIssueUpsertPlan {
  const detectedByFp = new Map(input.detected.map((row) => [row.fingerprint, row]));
  const insert: DataIssueCandidate[] = [];
  const refresh: Array<{ id: string; candidate: DataIssueCandidate }> = [];
  const autoResolve: Array<{ id: string }> = [];
  const blocked = new Set<string>();
  const active = new Set<string>();

  for (const row of input.existing) {
    if (row.status === 'dismissed') {
      blocked.add(row.fingerprint);
      continue;
    }
    if (row.status === 'resolved') continue;
    active.add(row.fingerprint);
    const detected = detectedByFp.get(row.fingerprint);
    if (detected) refresh.push({ id: row.id, candidate: detected });
    else autoResolve.push({ id: row.id });
  }

  for (const candidate of input.detected) {
    if (blocked.has(candidate.fingerprint) || active.has(candidate.fingerprint)) continue;
    insert.push(candidate);
  }

  return { insert, refresh, autoResolve };
}
