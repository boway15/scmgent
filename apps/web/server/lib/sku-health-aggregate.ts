import { db } from '@scm/db';
import { sql } from 'drizzle-orm';
import {
  normalizeInventoryHealth,
  pickWorstInventoryHealth,
  type InventoryHealth,
} from './inventory-light.js';

const SKU_IN_CHUNK = 2000;

const ALLOWED = new Set<InventoryHealth>(['red', 'yellow', 'green', 'blue', 'gray']);

export function parseHealthStatusesParam(raw: string | undefined): InventoryHealth[] {
  if (!raw?.trim()) return [];
  const out: InventoryHealth[] = [];
  const seen = new Set<InventoryHealth>();
  for (const part of raw.split(',')) {
    const n = normalizeInventoryHealth(part);
    if (!n || !ALLOWED.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function filterItemsByHealthStatuses<T extends { healthStatus?: InventoryHealth | null }>(
  items: T[],
  statuses: InventoryHealth[],
): T[] {
  if (statuses.length === 0) return items;
  const set = new Set(statuses);
  return items.filter((i) => i.healthStatus != null && set.has(i.healthStatus));
}

/** Attach worst-health map onto items; missing SKUs get null. */
export function attachHealthStatusToItems<T extends { skuId: string }>(
  items: T[],
  healthBySku: Map<string, InventoryHealth>,
): Array<T & { healthStatus: InventoryHealth | null }> {
  return items.map((item) => ({
    ...item,
    healthStatus: healthBySku.get(item.skuId) ?? null,
  }));
}

/** Attach per-warehouse health onto warehouse rows; missing codes get null. */
export function attachHealthStatusToWarehouses<T extends { warehouseCode: string }>(
  warehouses: T[],
  healthByWarehouse: Map<string, InventoryHealth>,
): Array<T & { healthStatus: InventoryHealth | null }> {
  return warehouses.map((w) => ({
    ...w,
    healthStatus: healthByWarehouse.get(w.warehouseCode) ?? null,
  }));
}

type LatestHealthRow = {
  skuId: string;
  healthStatus: string;
};

type LatestWarehouseHealthRow = {
  warehouseCode: string;
  healthStatus: string;
};

/** 各仓最新一条 → SKU 最差灯 */
export async function loadWorstHealthBySkuIds(
  skuIds: string[],
): Promise<Map<string, InventoryHealth>> {
  const result = new Map<string, InventoryHealth>();
  if (skuIds.length === 0) return result;

  const bySku = new Map<string, InventoryHealth[]>();

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const queryResult = await db.execute(sql`
      SELECT DISTINCT ON (sku_id, warehouse_code)
        sku_id AS "skuId",
        health_status AS "healthStatus"
      FROM inventory_health_snapshots
      WHERE sku_id IN (${sql.join(
        chunk.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      ORDER BY sku_id, warehouse_code, computed_at DESC, id DESC
    `);

    for (const row of Array.from(queryResult as unknown as LatestHealthRow[])) {
      const health = normalizeInventoryHealth(row.healthStatus);
      if (!health || !ALLOWED.has(health)) continue;
      const list = bySku.get(row.skuId);
      if (list) list.push(health);
      else bySku.set(row.skuId, [health]);
    }
  }

  for (const [skuId, statuses] of bySku) {
    const worst = pickWorstInventoryHealth(statuses);
    if (worst) result.set(skuId, worst);
  }

  return result;
}

/** 单 SKU 各仓最新一条健康灯 → Map<warehouseCode, InventoryHealth> */
export async function loadLatestHealthByWarehouseForSku(
  skuId: string,
): Promise<Map<string, InventoryHealth>> {
  const result = new Map<string, InventoryHealth>();
  if (!skuId) return result;

  const queryResult = await db.execute(sql`
    SELECT DISTINCT ON (warehouse_code)
      warehouse_code AS "warehouseCode",
      health_status AS "healthStatus"
    FROM inventory_health_snapshots
    WHERE sku_id = ${skuId}::uuid
    ORDER BY warehouse_code, computed_at DESC, id DESC
  `);

  for (const row of Array.from(queryResult as unknown as LatestWarehouseHealthRow[])) {
    const health = normalizeInventoryHealth(row.healthStatus);
    if (!health || !ALLOWED.has(health)) continue;
    result.set(row.warehouseCode, health);
  }

  return result;
}
