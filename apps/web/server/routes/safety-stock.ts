import { eq, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, safetyStockConfig, skus } from '@scm/db';
import { calcReorderPoint, calcReplenishment, type SalesDataPoint } from '../lib/replenishment.js';
import { requireMenu } from '../lib/rbac.js';
import { loadDailySalesForSku } from '../lib/sales-history-query.js';
import {
  calcSafetyStockQty,
  type SafetyStockMethod,
} from '../lib/safety-stock-z.js';

export const safetyStockRoutes = new Hono();

function resolveWarehouse(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query('warehouse')?.trim() || 'ALL';
}

type SafetyStockCalculationInput = {
  sales: SalesDataPoint[];
  leadTimeDays: number;
  unitCost: number;
  method: SafetyStockMethod;
  serviceLevel?: number | null;
  demandStdDev?: number | null;
  leadTimeStdDev?: number | null;
  safetyStockDays?: number | null;
};

export function calculateSafetyStockValues(params: SafetyStockCalculationInput) {
  const base = calcReplenishment({
    sales: params.sales,
    leadTimeDays: params.leadTimeDays,
    unitCost: params.unitCost,
  });
  const demandStdDev =
    params.method === 'coverage_days' ? 0 : (params.demandStdDev ?? base.stdDev);
  const safety = calcSafetyStockQty({
    method: params.method,
    serviceLevel: params.serviceLevel ?? undefined,
    demandStdDev,
    totalLeadDays: params.leadTimeDays,
    avgDaily: base.avgDaily,
    leadTimeStdDev: params.leadTimeStdDev ?? undefined,
    safetyStockDays: params.safetyStockDays ?? 14,
  });

  return {
    ...base,
    ...safety,
    reorderPoint: calcReorderPoint(base.avgDaily, params.leadTimeDays, safety.safetyStockQty),
    safetyStockMethod: params.method,
    serviceLevel: params.method === 'coverage_days' ? null : (params.serviceLevel ?? 0.95),
    demandStdDev: params.method === 'coverage_days' ? null : demandStdDev,
    leadTimeStdDev:
      params.method === 'z_demand_leadtime' ? (params.leadTimeStdDev ?? 0) : null,
  };
}

safetyStockRoutes.get('/safety-stock', async (c) => {
  const rows = await db
    .select({
      id: safetyStockConfig.id,
      skuId: skus.id,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: safetyStockConfig.warehouseCode,
      safetyStockQty: safetyStockConfig.safetyStockQty,
      reorderPoint: safetyStockConfig.reorderPoint,
      reorderQty: safetyStockConfig.reorderQty,
      safetyStockDays: safetyStockConfig.safetyStockDays,
      safetyStockMethod: safetyStockConfig.safetyStockMethod,
      serviceLevel: safetyStockConfig.serviceLevel,
      demandStdDev: safetyStockConfig.demandStdDev,
      leadTimeStdDev: safetyStockConfig.leadTimeStdDev,
      calcMethod: safetyStockConfig.calcMethod,
      lastCalcAt: safetyStockConfig.lastCalcAt,
    })
    .from(safetyStockConfig)
    .innerJoin(skus, eq(safetyStockConfig.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(skus.code, safetyStockConfig.warehouseCode);

  return c.json(rows);
});

safetyStockRoutes.put('/safety-stock/:skuId', requireMenu('inventory.safety'), async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const body = await c.req.json<{
    safetyStockQty: number;
    reorderPoint: number;
    reorderQty: number;
    safetyStockMethod?: SafetyStockMethod;
    serviceLevel?: number | null;
  }>();
  const method = body.safetyStockMethod ?? 'coverage_days';
  const values = {
    safetyStockQty: body.safetyStockQty,
    reorderPoint: body.reorderPoint,
    reorderQty: body.reorderQty,
    safetyStockMethod: method,
    serviceLevel:
      method === 'coverage_days' || body.serviceLevel == null ? null : String(body.serviceLevel),
  };

  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(safetyStockConfig)
      .set({
        ...values,
        calcMethod: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(safetyStockConfig.id, existing.id))
      .returning();
    return c.json(row);
  }

  const [row] = await db
    .insert(safetyStockConfig)
    .values({
      skuId,
      warehouseCode,
      ...values,
      calcMethod: 'manual',
    })
    .returning();

  return c.json(row, 201);
});

safetyStockRoutes.post('/safety-stock/:skuId/calculate', requireMenu('inventory.safety'), async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const body: {
    safetyStockMethod?: SafetyStockMethod;
    serviceLevel?: number | null;
  } = await c.req.json().catch(() => ({}));

  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const sales = await loadDailySalesForSku(skuId);

  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  const safetyStockMethod =
    body.safetyStockMethod ?? existing?.safetyStockMethod ?? 'coverage_days';
  const serviceLevel =
    body.serviceLevel ??
    (existing?.serviceLevel == null ? null : Number(existing.serviceLevel));
  const calc = calculateSafetyStockValues({
    sales: sales.map((s) => ({ qtySold: s.qtySold, saleDate: s.saleDate })),
    leadTimeDays: sku.leadTimeDays ?? 30,
    unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
    method: safetyStockMethod,
    serviceLevel,
    demandStdDev:
      existing?.demandStdDev == null ? null : Number(existing.demandStdDev),
    leadTimeStdDev:
      existing?.leadTimeStdDev == null ? null : Number(existing.leadTimeStdDev),
    safetyStockDays: existing?.safetyStockDays,
  });

  const values = {
    safetyStockQty: calc.safetyStockQty,
    reorderPoint: calc.reorderPoint,
    reorderQty: calc.reorderQty,
    safetyStockMethod,
    serviceLevel: calc.serviceLevel == null ? null : String(calc.serviceLevel),
    demandStdDev: calc.demandStdDev == null ? null : String(calc.demandStdDev),
    leadTimeStdDev:
      calc.leadTimeStdDev == null ? null : String(calc.leadTimeStdDev),
    calcMethod: 'eoq' as const,
    lastCalcAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(safetyStockConfig)
      .set(values)
      .where(eq(safetyStockConfig.id, existing.id))
      .returning();
    return c.json({ ...row, calc });
  }

  const [row] = await db
    .insert(safetyStockConfig)
    .values({ skuId, warehouseCode, ...values })
    .returning();

  return c.json({ ...row, calc });
});
