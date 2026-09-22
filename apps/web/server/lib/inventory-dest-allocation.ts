import { allocateByShare, type ShareParseResult } from './inventory-share-allocation.js';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import type { BuiltSupplyLot, SupplyLotPool, SupplyLotSource } from './inventory-supply-lots.js';

export const UNALLOCATED_WAREHOUSE = 'OVERSEAS';

export type DestAssignment = {
  warehouseCode: string;
  qty: number;
};

export type ConfirmedDestAllocation = {
  source: SupplyLotSource | string;
  sourceId: string;
  pool: SupplyLotPool | string;
  warehouseCode: string;
  qty: number;
};

export function isUnallocatedLot(lot: {
  warehouseCode: string;
  status: string;
}): boolean {
  return lot.status === 'open' && lot.warehouseCode === UNALLOCATED_WAREHOUSE;
}

export function suggestDestAssignments(qty: number, share: ShareParseResult): DestAssignment[] {
  if (qty <= 0) return [];
  const allocated = allocateByShare(qty, share);
  return [...allocated.entries()]
    .filter(([, destQty]) => destQty > 0)
    .map(([warehouseCode, destQty]) => ({ warehouseCode, qty: destQty }))
    .sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode));
}

function assertDestWarehouse(warehouseCode: string) {
  const code = warehouseCode.trim();
  if (!code || code === UNALLOCATED_WAREHOUSE || code === IN_PRODUCTION_WAREHOUSE) {
    throw new Error('目的仓不能是未分配或在产仓');
  }
  return code;
}

export function applyDestAssignments(
  lot: BuiltSupplyLot,
  assignments: DestAssignment[],
): BuiltSupplyLot[] {
  if (!isUnallocatedLot(lot)) {
    throw new Error('只有未定仓批次可以确认落仓');
  }
  const cleaned = assignments.map((row) => ({
    warehouseCode: assertDestWarehouse(row.warehouseCode),
    qty: Math.floor(row.qty),
  }));
  if (cleaned.some((row) => row.qty <= 0)) {
    throw new Error('分配数量必须为正整数');
  }
  const sum = cleaned.reduce((total, row) => total + row.qty, 0);
  if (sum !== lot.qty) {
    throw new Error(`分配数量合计必须等于批次数量 ${lot.qty}`);
  }
  return cleaned.map((row) => ({
    ...lot,
    warehouseCode: row.warehouseCode,
    qty: row.qty,
  }));
}

function allocationKey(row: { source: string; sourceId: string | null; pool: string }): string {
  return `${row.source}::${row.sourceId ?? ''}::${row.pool}`;
}

export function applyConfirmedDestinationsToLots(
  lots: BuiltSupplyLot[],
  allocations: ConfirmedDestAllocation[],
): BuiltSupplyLot[] {
  const byKey = new Map<string, ConfirmedDestAllocation[]>();
  for (const row of allocations) {
    if (row.qty <= 0 || !row.sourceId) continue;
    const key = allocationKey(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const result: BuiltSupplyLot[] = [];
  for (const lot of lots) {
    if (!isUnallocatedLot(lot) || !lot.sourceId) {
      result.push(lot);
      continue;
    }
    const confirmed = byKey.get(allocationKey({
      source: lot.source,
      sourceId: lot.sourceId,
      pool: lot.pool,
    }));
    if (!confirmed?.length) {
      result.push(lot);
      continue;
    }

    let remaining = lot.qty;
    for (const row of confirmed) {
      if (remaining <= 0) break;
      const qty = Math.min(row.qty, remaining);
      if (qty <= 0) continue;
      try {
        assertDestWarehouse(row.warehouseCode);
      } catch {
        continue;
      }
      result.push({ ...lot, warehouseCode: row.warehouseCode.trim(), qty });
      remaining -= qty;
    }
    if (remaining > 0) {
      result.push({ ...lot, warehouseCode: UNALLOCATED_WAREHOUSE, qty: remaining });
    }
  }
  return result;
}
