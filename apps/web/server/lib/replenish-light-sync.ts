import { inArray } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import type { InventoryHealth } from './inventory-light.js';
import { type ReplenishLight } from './replenish-light.js';

const HEALTH_RANK: Record<InventoryHealth, number> = {
  red: 0,
  yellow: 1,
  green: 2,
  blue: 3,
  gray: 4,
};

export function healthToReplenishLight(health: InventoryHealth): ReplenishLight {
  switch (health) {
    case 'red':
      return 'red';
    case 'yellow':
      return 'yellow';
    default:
      return 'green';
  }
}

export function aggregateWorstHealthBySku(
  rows: Array<{ skuId: string; healthStatus: InventoryHealth }>,
): Map<string, InventoryHealth> {
  const bySku = new Map<string, InventoryHealth>();
  for (const row of rows) {
    const current = bySku.get(row.skuId);
    if (!current || HEALTH_RANK[row.healthStatus] < HEALTH_RANK[current]) {
      bySku.set(row.skuId, row.healthStatus);
    }
  }
  return bySku;
}

export function isReplenishLightManualLocked(encodingMeta: unknown): boolean {
  if (!encodingMeta || typeof encodingMeta !== 'object') return false;
  return (encodingMeta as Record<string, unknown>).replenishLightManual === true;
}

export function markReplenishLightManual(encodingMeta: unknown): Record<string, unknown> {
  const base =
    encodingMeta && typeof encodingMeta === 'object'
      ? { ...(encodingMeta as Record<string, unknown>) }
      : {};
  return { ...base, replenishLightManual: true };
}

export async function syncReplenishLightFromHealth(
  rows: Array<{ skuId: string; healthStatus: InventoryHealth }>,
): Promise<{ updated: number; skippedLocked: number }> {
  const worstBySku = aggregateWorstHealthBySku(rows);
  const skuIds = [...worstBySku.keys()];
  if (!skuIds.length) return { updated: 0, skippedLocked: 0 };

  const existingRows: Array<{ id: string; encodingMeta: unknown }> = [];
  const READ_CHUNK = 2000;
  for (let offset = 0; offset < skuIds.length; offset += READ_CHUNK) {
    const chunk = skuIds.slice(offset, offset + READ_CHUNK);
    const rows = await db
      .select({ id: skus.id, encodingMeta: skus.encodingMeta })
      .from(skus)
      .where(inArray(skus.id, chunk));
    existingRows.push(...rows);
  }

  let updated = 0;
  let skippedLocked = 0;
  const idsByLight = new Map<ReplenishLight, string[]>();

  for (const sku of existingRows) {
    if (isReplenishLightManualLocked(sku.encodingMeta)) {
      skippedLocked += 1;
      continue;
    }
    const health = worstBySku.get(sku.id);
    if (!health) continue;
    const nextLight = healthToReplenishLight(health);
    const list = idsByLight.get(nextLight) ?? [];
    list.push(sku.id);
    idsByLight.set(nextLight, list);
  }

  const WRITE_CHUNK = 1000;
  const updatedAt = new Date();
  for (const [light, ids] of idsByLight) {
    for (let offset = 0; offset < ids.length; offset += WRITE_CHUNK) {
      const chunk = ids.slice(offset, offset + WRITE_CHUNK);
      await db
        .update(skus)
        .set({ replenishLight: light, updatedAt })
        .where(inArray(skus.id, chunk));
      updated += chunk.length;
    }
  }

  return { updated, skippedLocked };
}
