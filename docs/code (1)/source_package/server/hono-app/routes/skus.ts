import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, skus, spus } from '../_db';
import { upsertSkuSupplierFromImport } from '../lib/product-master';
import { requireMenu } from '../lib/rbac';
import { normalizeReplenishLight } from '../lib/replenish-light';

export const skuRoutes = new Hono();

skuRoutes.get('/skus', async (c) => {
  const rows = await db
    .select()
    .from(skus)
    .orderBy(desc(skus.createdAt))
    .limit(200);
  return c.json(rows);
});

skuRoutes.get('/skus/:id', async (c) => {
  const [row] = await db.select().from(skus).where(eq(skus.id, c.req.param('id'))).limit(1);
  if (!row) return c.json({ message: 'SKU not found' }, 404);
  return c.json(row);
});

skuRoutes.post('/skus', requireMenu('data.products'), async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    unit: string;
    spuId?: string;
    spuCode?: string;
    category?: string;
    specAttrs?: Record<string, string>;
    barcode?: string;
    leadTimeDays?: number;
    moq?: number;
    unitCost?: number;
    merchantCode?: string;
    merchantName?: string;
    replenishLight?: 'red' | 'yellow' | 'green';
  }>();

  if (!body.code?.trim() || !body.name?.trim() || !body.unit?.trim()) {
    return c.json({ message: 'code, name, unit are required' }, 400);
  }

  let spuId = body.spuId;
  if (!spuId && body.spuCode?.trim()) {
    const [spu] = await db.select().from(spus).where(eq(spus.code, body.spuCode.trim())).limit(1);
    if (!spu) return c.json({ message: 'SPU not found' }, 404);
    spuId = spu.id;
  }

  const [row] = await db
    .insert(skus)
    .values({
      code: body.code.trim(),
      name: body.name.trim(),
      unit: body.unit.trim(),
      spuId,
      category: body.category,
      specAttrs: body.specAttrs,
      barcode: body.barcode?.trim(),
      leadTimeDays: body.leadTimeDays,
      moq: body.moq,
      unitCost: body.unitCost?.toString(),
      merchantCode: body.merchantCode?.trim(),
      merchantName: body.merchantName?.trim(),
      replenishLight: normalizeReplenishLight(body.replenishLight),
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  if (body.merchantCode?.trim()) {
    await upsertSkuSupplierFromImport(row.id, body.merchantCode.trim(), body.merchantName, {
      unitPrice: body.unitCost?.toString(),
      leadTimeDays: body.leadTimeDays,
      moq: body.moq,
    });
    const [synced] = await db.select().from(skus).where(eq(skus.id, row.id)).limit(1);
    return c.json(synced ?? row, 201);
  }

  return c.json(row, 201);
});

skuRoutes.put('/skus/:id', requireMenu('data.products'), async (c) => {
  const skuId = c.req.param('id');
  const body = await c.req.json<Partial<{
    name: string;
    unit: string;
    spuId: string | null;
    category: string;
    specAttrs: Record<string, string>;
    barcode: string;
    leadTimeDays: number;
    moq: number;
    unitCost: number;
    isActive: boolean;
    merchantCode: string;
    merchantName: string;
    replenishLight: 'red' | 'yellow' | 'green';
  }>>();

  const { merchantCode, merchantName, unitCost, leadTimeDays, moq, replenishLight, ...skuFields } = body;

  const [row] = await db
    .update(skus)
    .set({
      ...skuFields,
      unitCost: skuFields.unitCost?.toString() ?? body.unitCost?.toString(),
      replenishLight: replenishLight ? normalizeReplenishLight(replenishLight) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(skus.id, skuId))
    .returning();

  if (!row) return c.json({ message: 'SKU not found' }, 404);

  if (merchantCode?.trim()) {
    await upsertSkuSupplierFromImport(skuId, merchantCode.trim(), merchantName, {
      unitPrice: unitCost?.toString() ?? row.unitCost ?? undefined,
      leadTimeDays: leadTimeDays ?? row.leadTimeDays ?? undefined,
      moq: moq ?? row.moq ?? undefined,
    });
    const [synced] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
    return c.json(synced ?? row);
  }

  return c.json(row);
});

skuRoutes.delete('/skus/:id', requireMenu('data.products'), async (c) => {
  const [row] = await db
    .update(skus)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(skus.id, c.req.param('id')))
    .returning();
  if (!row) return c.json({ message: 'SKU not found' }, 404);
  return c.json({ ok: true });
});
