import { eq, desc, and, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  spus,
  merchants,
  skus,
  skuSuppliers,
} from '@scm/db';
import {
  setDefaultSkuSupplier,
  syncSkuDefaultMerchant,
  upsertSkuSupplierFromImport,
} from '../lib/product-master.js';
import { requireMenu } from '../lib/rbac.js';
import { normalizeReplenishLight } from '../lib/replenish-light.js';

export const productRoutes = new Hono();

// --- SPU ---

productRoutes.get('/spus', async (c) => {
  const rows = await db.select().from(spus).orderBy(desc(spus.createdAt)).limit(500);
  return c.json(rows);
});

productRoutes.get('/spus/:id', async (c) => {
  const [row] = await db.select().from(spus).where(eq(spus.id, c.req.param('id'))).limit(1);
  if (!row) return c.json({ message: 'SPU not found' }, 404);

  const skuRows = await db
    .select()
    .from(skus)
    .where(and(eq(skus.spuId, row.id), eq(skus.isActive, true)))
    .orderBy(skus.code);

  return c.json({ ...row, skus: skuRows });
});

productRoutes.post('/spus', requireMenu('data.products'), async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    category?: string;
    brand?: string;
    description?: string;
    moq?: number;
  }>();

  if (!body.code?.trim() || !body.name?.trim()) {
    return c.json({ message: 'code, name are required' }, 400);
  }

  const [row] = await db
    .insert(spus)
    .values({
      code: body.code.trim(),
      name: body.name.trim(),
      category: body.category?.trim(),
      brand: body.brand?.trim(),
      description: body.description?.trim(),
      moq: body.moq,
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  return c.json(row, 201);
});

productRoutes.put('/spus/:id', requireMenu('data.products'), async (c) => {
  const body = await c.req.json<Partial<{
    name: string;
    category: string;
    brand: string;
    description: string;
    moq: number | null;
    isActive: boolean;
  }>>();

  const [row] = await db
    .update(spus)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(spus.id, c.req.param('id')))
    .returning();

  if (!row) return c.json({ message: 'SPU not found' }, 404);
  return c.json(row);
});

// --- Merchants ---

productRoutes.get('/merchants/master', async (c) => {
  const rows = await db.select().from(merchants).orderBy(merchants.code).limit(500);
  return c.json(rows);
});

productRoutes.post('/merchants', requireMenu('data.products'), async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    countryCode?: string;
    paymentTerms?: string;
    remark?: string;
  }>();

  if (!body.code?.trim() || !body.name?.trim()) {
    return c.json({ message: 'code, name are required' }, 400);
  }

  const [row] = await db
    .insert(merchants)
    .values({
      code: body.code.trim(),
      name: body.name.trim(),
      contactName: body.contactName?.trim(),
      contactPhone: body.contactPhone?.trim(),
      contactEmail: body.contactEmail?.trim(),
      countryCode: body.countryCode?.trim()?.toUpperCase(),
      paymentTerms: body.paymentTerms?.trim(),
      remark: body.remark?.trim(),
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  return c.json(row, 201);
});

productRoutes.put('/merchants/:id', requireMenu('data.products'), async (c) => {
  const body = await c.req.json<Partial<{
    name: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    countryCode: string;
    paymentTerms: string;
    remark: string;
    isActive: boolean;
  }>>();

  const [row] = await db
    .update(merchants)
    .set({
      ...body,
      countryCode: body.countryCode?.trim()?.toUpperCase(),
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, c.req.param('id')))
    .returning();

  if (!row) return c.json({ message: 'Merchant not found' }, 404);

  const linkedSkus = await db
    .select({ skuId: skuSuppliers.skuId })
    .from(skuSuppliers)
    .where(and(eq(skuSuppliers.merchantId, row.id), eq(skuSuppliers.isDefault, true)));

  for (const { skuId } of linkedSkus) {
    await syncSkuDefaultMerchant(skuId);
  }

  return c.json(row);
});

// --- SKU suppliers ---

productRoutes.get('/skus/:skuId/suppliers', async (c) => {
  const rows = await db
    .select({
      id: skuSuppliers.id,
      skuId: skuSuppliers.skuId,
      merchantId: merchants.id,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      unitPrice: skuSuppliers.unitPrice,
      leadTimeDays: skuSuppliers.leadTimeDays,
      moq: skuSuppliers.moq,
      isDefault: skuSuppliers.isDefault,
      isActive: skuSuppliers.isActive,
    })
    .from(skuSuppliers)
    .innerJoin(merchants, eq(merchants.id, skuSuppliers.merchantId))
    .where(eq(skuSuppliers.skuId, c.req.param('skuId')))
    .orderBy(desc(skuSuppliers.isDefault), merchants.code);

  return c.json(rows);
});

productRoutes.post('/skus/:skuId/suppliers', requireMenu('data.products'), async (c) => {
  const skuId = c.req.param('skuId');
  const body = await c.req.json<{
    merchantId?: string;
    merchantCode?: string;
    unitPrice?: number;
    leadTimeDays?: number;
    moq?: number;
    isDefault?: boolean;
  }>();

  let merchantId = body.merchantId;
  if (!merchantId && body.merchantCode) {
    const [m] = await db.select().from(merchants).where(eq(merchants.code, body.merchantCode.trim())).limit(1);
    if (!m) return c.json({ message: 'Merchant not found' }, 404);
    merchantId = m.id;
  }
  if (!merchantId) return c.json({ message: 'merchantId or merchantCode required' }, 400);

  const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const isDefault = body.isDefault ?? false;
  if (isDefault) {
    await db.update(skuSuppliers).set({ isDefault: false, updatedAt: new Date() }).where(eq(skuSuppliers.skuId, skuId));
  }

  const [existing] = await db
    .select()
    .from(skuSuppliers)
    .where(and(eq(skuSuppliers.skuId, skuId), eq(skuSuppliers.merchantId, merchantId)))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(skuSuppliers)
      .set({
        unitPrice: body.unitPrice?.toString() ?? existing.unitPrice,
        leadTimeDays: body.leadTimeDays ?? existing.leadTimeDays,
        moq: body.moq ?? existing.moq,
        isDefault: isDefault || existing.isDefault,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(skuSuppliers.id, existing.id))
      .returning();
  } else {
    const hasDefault = await db
      .select({ id: skuSuppliers.id })
      .from(skuSuppliers)
      .where(and(eq(skuSuppliers.skuId, skuId), eq(skuSuppliers.isDefault, true)))
      .limit(1);

    [row] = await db
      .insert(skuSuppliers)
      .values({
        skuId,
        merchantId,
        unitPrice: body.unitPrice?.toString(),
        leadTimeDays: body.leadTimeDays,
        moq: body.moq,
        isDefault: isDefault || !hasDefault.length,
        isActive: true,
      })
      .returning();
  }

  if (row?.isDefault) await syncSkuDefaultMerchant(skuId);
  return c.json(row, existing ? 200 : 201);
});

productRoutes.put('/sku-suppliers/:id/default', requireMenu('data.products'), async (c) => {
  const [link] = await db.select().from(skuSuppliers).where(eq(skuSuppliers.id, c.req.param('id'))).limit(1);
  if (!link) return c.json({ message: 'Supplier link not found' }, 404);

  await setDefaultSkuSupplier(link.skuId, link.id);
  const [row] = await db.select().from(skuSuppliers).where(eq(skuSuppliers.id, link.id)).limit(1);
  return c.json(row);
});

// --- Enriched SKU list for product master page ---

productRoutes.get('/products/sku-overview', async (c) => {
  const rows = await db
    .select({
      id: skus.id,
      code: skus.code,
      name: skus.name,
      unit: skus.unit,
      category: skus.category,
      spuId: skus.spuId,
      spuCode: spus.code,
      spuName: spus.name,
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
      replenishLight: skus.replenishLight,
      supplierCount: sql<number>`(
        SELECT count(*)::int FROM sku_suppliers ss
        WHERE ss.sku_id = ${skus.id} AND ss.is_active = true
      )`,
      isActive: skus.isActive,
    })
    .from(skus)
    .leftJoin(spus, eq(spus.id, skus.spuId))
    .orderBy(desc(skus.updatedAt))
    .limit(500);

  return c.json(
    rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      unit: row.unit,
      category: row.category,
      spuId: row.spuId,
      spuCode: row.spuCode,
      spuName: row.spuName,
      merchantCode: row.merchantCode,
      merchantName: row.merchantName,
      replenishLight: normalizeReplenishLight(row.replenishLight),
      supplierCount: row.supplierCount,
      isActive: row.isActive,
    })),
  );
});
