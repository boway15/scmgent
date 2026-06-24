import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import {
  db,
  inventoryHealthSnapshots,
  inventoryExceptions,
  reorderSuggestions,
  stockAlerts,
} from '@scm/db';
import type { SkuHealthRow } from './inventory-health-service.js';
import {
  healthToExceptionType,
  recommendedActionForException,
} from './inventory-health-service.js';

export async function saveHealthSnapshots(
  rows: SkuHealthRow[],
  runId?: string,
): Promise<number> {
  if (!rows.length) return 0;
  const computedAt = new Date();
  await db.insert(inventoryHealthSnapshots).values(
    rows.map((row) => ({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      healthStatus: row.healthStatus,
      coverageDays: Number.isFinite(row.coverageDays) ? String(row.coverageDays) : null,
      effectiveQty: row.effectiveQty,
      avgDaily: String(row.avgDaily),
      demandSource: row.demandSource,
      totalLeadDays: row.totalLeadDays,
      latestOrderDays: Number.isFinite(row.latestOrderDays)
        ? String(row.latestOrderDays)
        : null,
      metrics: row.metrics,
      computedAt,
      runId: runId ?? null,
    })),
  );
  return rows.length;
}

export async function getLatestHealthSnapshots(params?: {
  warehouseCode?: string;
  healthStatus?: string;
  limit?: number;
}) {
  const limit = params?.limit ?? 500;
  const allSkus = await db
    .select({
      id: inventoryHealthSnapshots.id,
      skuId: inventoryHealthSnapshots.skuId,
      warehouseCode: inventoryHealthSnapshots.warehouseCode,
      healthStatus: inventoryHealthSnapshots.healthStatus,
      coverageDays: inventoryHealthSnapshots.coverageDays,
      effectiveQty: inventoryHealthSnapshots.effectiveQty,
      avgDaily: inventoryHealthSnapshots.avgDaily,
      demandSource: inventoryHealthSnapshots.demandSource,
      totalLeadDays: inventoryHealthSnapshots.totalLeadDays,
      latestOrderDays: inventoryHealthSnapshots.latestOrderDays,
      metrics: inventoryHealthSnapshots.metrics,
      computedAt: inventoryHealthSnapshots.computedAt,
    })
    .from(inventoryHealthSnapshots)
    .orderBy(desc(inventoryHealthSnapshots.computedAt))
    .limit(limit * 20);

  const latestByKey = new Map<string, (typeof allSkus)[0]>();
  for (const row of allSkus) {
    const key = `${row.skuId}::${row.warehouseCode}`;
    if (!latestByKey.has(key)) latestByKey.set(key, row);
  }

  let result = Array.from(latestByKey.values());
  if (params?.warehouseCode) {
    result = result.filter((r) => r.warehouseCode === params.warehouseCode);
  }
  if (params?.healthStatus) {
    result = result.filter((r) => r.healthStatus === params.healthStatus);
  }
  return result.slice(0, limit);
}

export async function upsertInventoryExceptions(rows: SkuHealthRow[]): Promise<number> {
  let count = 0;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  const dueStr = dueDate.toISOString().slice(0, 10);

  for (const row of rows) {
    const exceptionType = healthToExceptionType(row.healthStatus, row.lifecycle);
    if (!exceptionType) continue;

    const open = await db
      .select({ id: inventoryExceptions.id })
      .from(inventoryExceptions)
      .where(
        and(
          eq(inventoryExceptions.skuId, row.skuId),
          eq(inventoryExceptions.warehouseCode, row.warehouseCode),
          eq(inventoryExceptions.exceptionType, exceptionType),
          inArray(inventoryExceptions.status, ['open', 'in_progress']),
        ),
      )
      .limit(1);

    if (open.length) continue;

    await db.insert(inventoryExceptions).values({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      exceptionType,
      healthStatus: row.healthStatus,
      recommendedAction: recommendedActionForException(exceptionType),
      status: 'open',
      dueDate: dueStr,
    });
    count++;
  }
  return count;
}

export async function supersedePendingSuggestions(skuId: string, warehouseCode: string) {
  await db
    .update(reorderSuggestions)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(reorderSuggestions.skuId, skuId),
        eq(reorderSuggestions.warehouseCode, warehouseCode),
        eq(reorderSuggestions.status, 'pending'),
        isNull(reorderSuggestions.supersededAt),
      ),
    );
}

export async function findOpenStockAlert(params: {
  skuId: string;
  warehouseCode: string | null;
  alertType: 'stockout' | 'below_safety' | 'below_rop';
}) {
  const conditions = [
    eq(stockAlerts.skuId, params.skuId),
    eq(stockAlerts.alertType, params.alertType),
    eq(stockAlerts.isResolved, false),
  ];
  if (params.warehouseCode) {
    conditions.push(eq(stockAlerts.warehouseCode, params.warehouseCode));
  }
  const [row] = await db
    .select()
    .from(stockAlerts)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function resolveStockAlertsForSkuWarehouse(params: {
  skuId: string;
  warehouseCode: string | null;
  resolvedBy?: string;
}) {
  const conditions = [
    eq(stockAlerts.skuId, params.skuId),
    eq(stockAlerts.isResolved, false),
  ];
  if (params.warehouseCode) {
    conditions.push(eq(stockAlerts.warehouseCode, params.warehouseCode));
  }
  const now = new Date();
  await db
    .update(stockAlerts)
    .set({
      isResolved: true,
      resolvedAt: now,
      resolvedBy: params.resolvedBy ?? null,
    })
    .where(and(...conditions));
}
