import { eq, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, safetyStockConfig, skus, salesHistory } from '../_db';
import { calcReplenishment } from '../lib/replenishment';
import { requireMenu } from '../lib/rbac';

export const safetyStockRoutes = new Hono();

function resolveWarehouse(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query('warehouse')?.trim() || 'ALL';
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
  const skuId = c.req.param('skuId');
  const warehouseCode = resolveWarehouse(c);
  const body = await c.req.json<{
    safetyStockQty: number;
    reorderPoint: number;
    reorderQty: number;
  }>();

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
        ...body,
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
      ...body,
      calcMethod: 'manual',
    })
    .returning();

  return c.json(row, 201);
});

safetyStockRoutes.post('/safety-stock/:skuId/calculate', requireMenu('inventory.safety'), async (c) => {
  const skuId = c.req.param('skuId');
  const warehouseCode = resolveWarehouse(c);

  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const sales = await db
    .select({ qtySold: salesHistory.qtySold, saleDate: salesHistory.saleDate })
    .from(salesHistory)
    .where(eq(salesHistory.skuId, skuId));

  const calc = calcReplenishment({
    sales: sales.map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) })),
    leadTimeDays: sku.leadTimeDays ?? 30,
    unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
  });

  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  const values = {
    safetyStockQty: calc.safetyStockQty,
    reorderPoint: calc.reorderPoint,
    reorderQty: calc.reorderQty,
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
