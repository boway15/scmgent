import { FEISHU_REGION_SALES_SHARE_FIELDS } from './inventory-turnover-feishu-headers.js';
import { TURNOVER_BUCKET_WAREHOUSE_MAP } from './turnover-bucket-warehouse.js';
import { addDaysIso } from './inventory-iso-date.js';

export const SHARE_MISMATCH_DELTA = 0.05;

export type ShareParseResult = {
  method: 'sales_share' | 'unallocated';
  shareSum: number;
  shareSumWarning: boolean;
  /** 仅正权重；sales_share 时已归一化使 Σweight=1 */
  weights: Array<{ warehouse: string; weight: number }>;
};

export type ResidualTransitSlice = {
  qty: number;
  availableAt: string | null;
  bucket: 'd5' | 'd15' | 'd25' | 'earliest' | 'undated';
};

export type PlanningAllocationMethod = 'sales_share' | 'native_warehouse' | 'unallocated';

export type PlanningAllocation = {
  method: PlanningAllocationMethod;
  snapshotDate: string | null;
  overseasTotal: number;
  allocatedQty: number;
  undatedTransitQty: number;
  shareSumWarning: boolean;
};

function parseQtyInt(raw: string | undefined | null): number {
  const parsed = parseInt(String(raw ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseShareValue(raw: string | undefined | null): number {
  const value = String(raw ?? '').trim().replace(/,/g, '');
  if (!value) return 0;
  const asPct = value.endsWith('%');
  const parsed = parseFloat(asPct ? value.slice(0, -1) : value);
  if (!Number.isFinite(parsed)) return 0;
  return asPct ? parsed / 100 : parsed;
}

export function parseSharesFromSnapshot(snapshot: Record<string, string | undefined>): ShareParseResult {
  const positive: Array<{ warehouse: string; weight: number }> = [];
  let shareSum = 0;

  for (const region of FEISHU_REGION_SALES_SHARE_FIELDS) {
    const warehouse = TURNOVER_BUCKET_WAREHOUSE_MAP[region];
    if (!warehouse) continue;
    const weight = parseShareValue(snapshot[region]);
    if (weight <= 0) continue;
    shareSum += weight;
    positive.push({ warehouse, weight });
  }

  if (positive.length === 0 || shareSum <= 0) {
    return { method: 'unallocated', shareSum: 0, shareSumWarning: false, weights: [] };
  }

  return {
    method: 'sales_share',
    shareSum,
    shareSumWarning: Math.abs(shareSum - 1) > SHARE_MISMATCH_DELTA,
    weights: positive.map((row) => ({ warehouse: row.warehouse, weight: row.weight / shareSum })),
  };
}

export function allocateByShare(qty: number, parsed: ShareParseResult): Map<string, number> {
  if (qty <= 0 || parsed.method === 'unallocated' || parsed.weights.length === 0) {
    return new Map();
  }

  const floors = parsed.weights.map((row) => {
    const exact = qty * row.weight;
    const floor = Math.floor(exact);
    return { warehouse: row.warehouse, floor, remainder: exact - floor };
  });

  let remaining = qty - floors.reduce((sum, row) => sum + row.floor, 0);
  floors.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.warehouse.localeCompare(b.warehouse);
  });

  for (const row of floors) {
    if (remaining <= 0) break;
    row.floor += 1;
    remaining -= 1;
  }

  const allocated = new Map<string, number>();
  for (const row of floors) {
    if (row.floor > 0) allocated.set(row.warehouse, row.floor);
  }
  return allocated;
}

export function parseTransitBuckets(snapshot: Record<string, string | undefined>): {
  d5: number;
  d15: number;
  d25: number;
} {
  return {
    d5: parseQtyInt(snapshot['预计10天上架_合计']),
    d15: parseQtyInt(snapshot['预计10-20天上架_合计']),
    d25: parseQtyInt(snapshot['预计超20天上架_合计']),
  };
}

export function splitResidualTransit(params: {
  residual: number;
  buckets: { d5: number; d15: number; d25: number };
  earliestAvailableAt: string | null;
  today: string;
}): ResidualTransitSlice[] {
  const { residual, buckets, earliestAvailableAt, today } = params;
  if (residual <= 0) return [];

  const d5 = Math.max(0, buckets.d5);
  const d15 = Math.max(0, buckets.d15);
  const d25 = Math.max(0, buckets.d25);
  const bucketSum = d5 + d15 + d25;

  if (bucketSum > 0 && bucketSum <= residual) {
    const slices: ResidualTransitSlice[] = [];
    if (d5 > 0) slices.push({ qty: d5, availableAt: addDaysIso(today, 5), bucket: 'd5' });
    if (d15 > 0) slices.push({ qty: d15, availableAt: addDaysIso(today, 15), bucket: 'd15' });
    if (d25 > 0) slices.push({ qty: d25, availableAt: addDaysIso(today, 25), bucket: 'd25' });
    const undated = residual - bucketSum;
    if (undated > 0) slices.push({ qty: undated, availableAt: null, bucket: 'undated' });
    return slices;
  }

  if (bucketSum > residual) {
    const allocated = allocateByShare(residual, {
      method: 'sales_share',
      shareSum: 1,
      shareSumWarning: false,
      weights: [
        { warehouse: 'd5', weight: d5 / bucketSum },
        { warehouse: 'd15', weight: d15 / bucketSum },
        { warehouse: 'd25', weight: d25 / bucketSum },
      ].filter((row) => row.weight > 0),
    });
    const slices: ResidualTransitSlice[] = [];
    for (const bucket of ['d5', 'd15', 'd25'] as const) {
      const qty = allocated.get(bucket) ?? 0;
      if (qty <= 0) continue;
      const offset = bucket === 'd5' ? 5 : bucket === 'd15' ? 15 : 25;
      slices.push({ qty, availableAt: addDaysIso(today, offset), bucket });
    }
    return slices;
  }

  if (earliestAvailableAt) {
    return [{ qty: residual, availableAt: earliestAvailableAt, bucket: 'earliest' }];
  }

  return [{ qty: residual, availableAt: null, bucket: 'undated' }];
}

export function resolvePlanningAllocation(params: {
  planningWarehouse: string;
  nativeWarehouseQty: number;
  overseasTotal: number;
  share: ShareParseResult;
  allocatedQty: number;
  undatedTransitQty: number;
  snapshotDate: string | null;
}): PlanningAllocation {
  let method: PlanningAllocationMethod;
  if (params.nativeWarehouseQty > 0) {
    method = 'native_warehouse';
  } else if (params.share.method === 'sales_share') {
    method = 'sales_share';
  } else if (params.overseasTotal > 0 && params.share.method === 'unallocated') {
    method = 'unallocated';
  } else {
    method = 'native_warehouse';
  }

  return {
    method,
    snapshotDate: params.snapshotDate,
    overseasTotal: params.overseasTotal,
    allocatedQty: params.allocatedQty,
    undatedTransitQty: params.undatedTransitQty,
    shareSumWarning: params.share.shareSumWarning,
  };
}

export function shouldSkipConfirmedHorizon(method: PlanningAllocationMethod): boolean {
  return method === 'unallocated';
}
