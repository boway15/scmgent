import type { ShareParseResult } from './inventory-share-allocation.js';

export const DATA_ISSUE_TYPES = [
  'missing_available_at',
  'unallocated_warehouse',
  'share_sum_mismatch',
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
