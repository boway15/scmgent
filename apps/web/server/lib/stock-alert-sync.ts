/**
 * 缺货预警每日覆盖：每轮扫描先清空 open，再写入本轮快照（与数据问题 scan_cleared 同思路）。
 */
import type { InventoryHealth } from './inventory-light.js';
import { effectiveQtyWithProductionFallback } from './inventory-position.js';

export type StockAlertKeyParts = {
  skuId: string;
  warehouseCode: string | null;
  alertType: string;
  horizonDays?: number | null;
};

/** stock_alerts 数量列为 integer；时间轴结余/覆盖天数可能为小数。 */
export function stockAlertIntegerQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

const IMMEDIATE_ALERT_TYPES = new Set(['stockout', 'below_safety', 'below_rop']);

/** 本仓零需求时零库存不算断货（如某 SKU 不在该区域销售） */
export function shouldEmitImmediateAlert(alertType: string, avgDaily: number): boolean {
  if (alertType === 'stockout') return avgDaily > 0;
  return true;
}

/** 时间轴派生预警仅在与决策灯一致时落库，避免绿灯 SKU 刷出海量 coverage_short。 */
export function shouldPersistHorizonAlert(
  alertType: string,
  decisionHealth: InventoryHealth,
): boolean {
  if (IMMEDIATE_ALERT_TYPES.has(alertType)) return true;
  switch (alertType) {
    case 'coverage_short':
    case 'stockout_horizon':
    case 'uncoverable_by_new_po':
      return decisionHealth === 'red' || decisionHealth === 'yellow';
    case 'overstock':
      return decisionHealth === 'blue';
    default:
      return decisionHealth !== 'gray';
  }
}

export function dedupeStockAlertIncoming(incoming: StockAlertIncoming[]): StockAlertIncoming[] {
  const byFingerprint = new Map<string, StockAlertIncoming>();
  for (const item of incoming) {
    byFingerprint.set(
      stockAlertFingerprint({
        skuId: item.skuId,
        warehouseCode: item.warehouseCode,
        alertType: item.alertType,
        horizonDays: item.horizonDays,
      }),
      item,
    );
  }
  return [...byFingerprint.values()];
}

export function stockAlertFingerprint(parts: StockAlertKeyParts): string {
  const horizon =
    parts.horizonDays == null || Number.isNaN(parts.horizonDays)
      ? ''
      : String(parts.horizonDays);
  return [parts.skuId, parts.warehouseCode ?? '', parts.alertType, horizon].join('::');
}

export type OpenStockAlertRef = {
  id: string;
  skuId: string;
  warehouseCode: string | null;
  alertType: string;
  horizonDays: number | null;
  projectedQty: number | null;
  projectedStockoutDate: string | null;
};

export type StockAlertIncoming = {
  skuId: string;
  warehouseCode: string;
  alertType: string;
  currentQty: number;
  safetyQty: number;
  horizonDays?: number | null;
  projectedQty?: number | null;
  projectedStockoutDate?: string | null;
  skuCode?: string;
  displayType?: string;
};

export type StockAlertUpdate = {
  id: string;
  currentQty: number;
  safetyQty: number;
  projectedQty: number | null;
  projectedStockoutDate: string | null;
};

/** 用已打开预警对齐本轮命中：已存在则刷新，否则插入；同一指纹只处理一次。 */
export function diffStockAlertWrites(input: {
  openAlerts: OpenStockAlertRef[];
  incoming: StockAlertIncoming[];
}): {
  activeFingerprints: Set<string>;
  inserts: StockAlertIncoming[];
  updates: StockAlertUpdate[];
} {
  const byFingerprint = new Map<string, OpenStockAlertRef>();
  for (const row of input.openAlerts) {
    const fingerprint = stockAlertFingerprint(row);
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, row);
  }

  const activeFingerprints = new Set<string>();
  const inserts: StockAlertIncoming[] = [];
  const updatesById = new Map<string, StockAlertUpdate>();
  const pendingInserts = new Set<string>();

  for (const item of input.incoming) {
    const fingerprint = stockAlertFingerprint({
      skuId: item.skuId,
      warehouseCode: item.warehouseCode,
      alertType: item.alertType,
      horizonDays: item.horizonDays,
    });
    activeFingerprints.add(fingerprint);
    const existing = byFingerprint.get(fingerprint);
    if (existing) {
      updatesById.set(existing.id, {
        id: existing.id,
        currentQty: item.currentQty,
        safetyQty: item.safetyQty,
        projectedQty: item.projectedQty ?? existing.projectedQty,
        projectedStockoutDate:
          item.projectedStockoutDate !== undefined
            ? item.projectedStockoutDate
            : existing.projectedStockoutDate,
      });
      continue;
    }
    if (pendingInserts.has(fingerprint)) continue;
    pendingInserts.add(fingerprint);
    inserts.push(item);
  }

  return { activeFingerprints, inserts, updates: [...updatesById.values()] };
}

/** 区域网络有效供给：各仓 effective 相加，在产池只补一次。 */
export function regionNetworkEffectiveBySku(input: {
  rows: Array<{
    skuId: string;
    regionGroup: string;
    effectiveQty: number;
    qtyInProduction: number;
  }>;
  regionGroup: string;
  productionQtyBySku?: ReadonlyMap<string, number>;
}): Map<string, number> {
  const grouped = new Map<string, Array<{ effectiveQty: number; qtyInProduction: number }>>();
  for (const row of input.rows) {
    if (row.regionGroup !== input.regionGroup) continue;
    const list = grouped.get(row.skuId) ?? [];
    list.push(row);
    grouped.set(row.skuId, list);
  }
  const out = new Map<string, number>();
  for (const [skuId, positions] of grouped) {
    out.set(
      skuId,
      effectiveQtyWithProductionFallback(positions, input.productionQtyBySku?.get(skuId) ?? 0),
    );
  }
  return out;
}

export function planStaleStockAlertResolve(input: {
  openAlerts: Array<{ id: string; fingerprint: string }>;
  activeFingerprints: Iterable<string>;
}): string[] {
  const active = input.activeFingerprints instanceof Set
    ? input.activeFingerprints
    : new Set(input.activeFingerprints);
  const staleIds: string[] = [];
  for (const row of input.openAlerts) {
    if (!active.has(row.fingerprint)) staleIds.push(row.id);
  }
  return staleIds;
}
