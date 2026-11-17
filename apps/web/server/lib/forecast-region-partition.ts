/**
 * 销量按销售区域分桶的纯函数。
 *
 * 预测基线生成需要把 `sales_history` 的日销按 `resolveSalesRowRegion` 归区，
 * 而不是把所有站点合并成 ALL。本模块提供归区分组与按区从日销派生月销的纯函数，
 * 便于在 forecast-collaboration 中按 (sku × region × platform) 训练叶子。
 */
import type { RegionMappingTables, RuntimeRegion } from './region-mapping.js';
import { resolveSalesRowRegion } from './region-mapping.js';

/** 带站点/行上区域的日销行。warehouseCode 仍保留以兼容旧过滤路径。 */
export type RegionPartitionableRow = {
  station?: string | null;
  /** 已入库的销售区域码；优先于站点映射 */
  salesRegion?: string | null;
  warehouseCode?: string | null;
};

/**
 * 把行按销售区域分组。
 * - 优先行上 `salesRegion`（飞书同步/映射补齐后的码）
 * - 否则 `resolveSalesRegion(station)`
 * - 未映射或空 → 'UNMAPPED'
 */
export function groupRowsBySalesRegion<T extends RegionPartitionableRow>(
  rows: readonly T[],
  tables: RegionMappingTables,
): Map<RuntimeRegion, T[]> {
  const groups = new Map<RuntimeRegion, T[]>();
  for (const row of rows) {
    const region = resolveSalesRowRegion(row, tables);
    const list = groups.get(region) ?? [];
    list.push(row);
    groups.set(region, list);
  }
  return groups;
}

/** 收集出现在映射表中的所有可配置区域（不含 UNMAPPED）。 */
export function collectMappedRegions(tables: RegionMappingTables): RuntimeRegion[] {
  const set = new Set<RuntimeRegion>();
  for (const region of tables.stations.values()) set.add(region);
  for (const region of tables.warehouses.values()) set.add(region);
  return [...set];
}

export type SalesRegionBucket = {
  region: RuntimeRegion;
  /** 仅包含这些站点（归一后精确匹配）；undefined 表示不限 */
  stationIn?: string[];
  /** 排除这些站点（用于 UNMAPPED 桶） */
  stationNotIn?: string[];
};

/**
 * 按销售区域构建生成桶：每个可配置区域取其站点列表；UNMAPPED 桶排除所有已映射站点。
 * 仅依据站点映射表（仓库映射不参与销量归区）。
 */
export function buildSalesRegionBuckets(tables: RegionMappingTables): SalesRegionBucket[] {
  const buckets: SalesRegionBucket[] = [];
  const allMappedStations = [...tables.stations.keys()];
  const regions = new Set<RuntimeRegion>();
  for (const region of tables.stations.values()) regions.add(region);
  for (const region of [...regions].sort()) {
    const stationIn = [...tables.stations.entries()]
      .filter(([, r]) => r === region)
      .map(([s]) => s);
    buckets.push({ region, stationIn });
  }
  buckets.push({ region: 'UNMAPPED', stationNotIn: allMappedStations });
  return buckets;
}

export type DerivedMonthlyRow = {
  saleYear: number;
  month: number;
  qtySold: number;
};

/**
 * 从日销行按 (saleYear, month) 聚合出月销量。
 * - 仅聚合 `saleDate` 形如 YYYY-MM-DD 的行；非法日期跳过
 * - 用于在 sales_history_monthly 缺少 station 列时，按区域从日销派生月序列
 */
export function deriveMonthlyQtyFromDaily<T extends { saleDate: string; qtySold: number }>(
  rows: readonly T[],
): DerivedMonthlyRow[] {
  const map = new Map<string, DerivedMonthlyRow>();
  for (const row of rows) {
    const dateText = String(row.saleDate).slice(0, 10);
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateText);
    if (!match) continue;
    const saleYear = Number(match[1]);
    const month = Number(match[2]);
    if (!saleYear || !month) continue;
    const key = `${saleYear}-${month}`;
    const existing = map.get(key);
    const qty = Number(row.qtySold) || 0;
    if (existing) {
      existing.qtySold += qty;
    } else {
      map.set(key, { saleYear, month, qtySold: qty });
    }
  }
  return [...map.values()];
}

/** 计算行集合内最早销售日（YYYY-MM-DD）；无销售返回 null。 */
export function firstSaleDateFromRows<T extends { saleDate: string }>(rows: readonly T[]): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    const dateText = String(row.saleDate).slice(0, 10);
    if (!dateText) continue;
    if (earliest === null || dateText < earliest) earliest = dateText;
  }
  return earliest;
}
