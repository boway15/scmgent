import { eq, desc, and, or, sql, ilike, type SQL } from 'drizzle-orm';
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
import { parseListPagination } from '../lib/list-pagination.js';
import { requireMenu } from '../lib/rbac.js';
import { normalizeReplenishLight } from '../lib/replenish-light.js';
import { readSkuPackagingFromEncodingMeta, readTurnoverSnapshotAt } from '../lib/inventory-turnover-snapshot.js';
import { pickLatestIso } from '../lib/pick-latest-iso.js';

export const productRoutes = new Hono();

function ilikeContains(raw: string): string {
  return `%${raw.trim().replace(/[%_\\]/g, '\\$&')}%`;
}

function buildSpuWhere(query: { q?: string; category?: string; brand?: string }): SQL | undefined {
  const parts: SQL[] = [];
  if (query.q?.trim()) {
    const pattern = ilikeContains(query.q);
    parts.push(or(ilike(spus.code, pattern), ilike(spus.name, pattern))!);
  }
  if (query.category?.trim()) {
    parts.push(ilike(spus.category, ilikeContains(query.category)));
  }
  if (query.brand?.trim()) {
    parts.push(ilike(spus.brand, ilikeContains(query.brand)));
  }
  return parts.length ? and(...parts) : undefined;
}

function buildMerchantWhere(query: { q?: string }): SQL | undefined {
  if (!query.q?.trim()) return undefined;
  const pattern = ilikeContains(query.q);
  return or(ilike(merchants.code, pattern), ilike(merchants.name, pattern));
}

function buildSkuOverviewWhere(query: {
  q?: string;
  category?: string;
  lifecycle?: string;
  salesCountry?: string;
  merchantCode?: string;
  ownerName?: string;
  developerName?: string;
}): SQL | undefined {
  const parts: SQL[] = [];
  if (query.q?.trim()) {
    const pattern = ilikeContains(query.q);
    parts.push(or(ilike(skus.code, pattern), ilike(skus.name, pattern))!);
  }
  if (query.category?.trim()) {
    parts.push(ilike(skus.category, ilikeContains(query.category)));
  }
  if (query.lifecycle?.trim()) {
    parts.push(ilike(skus.lifecycle, ilikeContains(query.lifecycle)));
  }
  if (query.salesCountry?.trim()) {
    parts.push(ilike(skus.salesCountry, ilikeContains(query.salesCountry)));
  }
  if (query.merchantCode?.trim()) {
    parts.push(ilike(skus.merchantCode, ilikeContains(query.merchantCode)));
  }
  if (query.ownerName?.trim()) {
    parts.push(ilike(skus.ownerName, ilikeContains(query.ownerName)));
  }
  if (query.developerName?.trim()) {
    parts.push(ilike(skus.developerName, ilikeContains(query.developerName)));
  }
  return parts.length ? and(...parts) : undefined;
}

// --- SPU ---

productRoutes.get('/spus', async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const where = buildSpuWhere({
    q: c.req.query('q')?.trim(),
    category: c.req.query('category')?.trim(),
    brand: c.req.query('brand')?.trim(),
  });
  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(spus)
      .where(where)
      .orderBy(desc(spus.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(spus)
      .where(where),
  ]);
  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
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
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const where = buildMerchantWhere({ q: c.req.query('q')?.trim() });
  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(merchants)
      .where(where)
      .orderBy(merchants.code)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(merchants)
      .where(where),
  ]);
  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
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
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const where = buildSkuOverviewWhere({
    q: c.req.query('q')?.trim(),
    category: c.req.query('category')?.trim(),
    lifecycle: c.req.query('lifecycle')?.trim(),
    salesCountry: c.req.query('salesCountry')?.trim(),
    merchantCode: c.req.query('merchantCode')?.trim(),
    ownerName: c.req.query('ownerName')?.trim(),
    developerName: c.req.query('developerName')?.trim(),
  });

  const base = db
    .select({
      id: skus.id,
      code: skus.code,
      name: skus.name,
      unit: skus.unit,
      category: skus.category,
      lifecycle: skus.lifecycle,
      salesCountry: skus.salesCountry,
      productCategory: skus.productCategory,
      ownerName: skus.ownerName,
      developerName: skus.developerName,
      spuId: skus.spuId,
      spuCode: spus.code,
      spuName: spus.name,
      externalCode: skus.externalCode,
      skuKind: skus.skuKind,
      divisionCode: skus.divisionCode,
      divisionName: spus.divisionName,
      encodingValid: skus.encodingValid,
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
      leadTimeDays: skus.leadTimeDays,
      moq: skus.moq,
      unitCost: skus.unitCost,
      replenishLight: skus.replenishLight,
      encodingMeta: skus.encodingMeta,
      skuUpdatedAt: skus.updatedAt,
      inventoryUpdatedAt: sql<Date | null>`(
        (SELECT max(created_at) FROM inventory_records ir WHERE ir.sku_id = ${skus.id})
      )`,
      supplierCount: sql<number>`(
        SELECT count(*)::int FROM sku_suppliers ss
        WHERE ss.sku_id = ${skus.id} AND ss.is_active = true
      )`,
      isActive: skus.isActive,
    })
    .from(skus)
    .leftJoin(spus, eq(spus.id, skus.spuId))
    .where(where)
    .$dynamic();

  const [rows, countRow] = await Promise.all([
    base.orderBy(desc(skus.updatedAt)).limit(pageSize).offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(skus)
      .where(where),
  ]);

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      unit: row.unit,
      category: row.category,
      lifecycle: row.lifecycle,
      salesCountry: row.salesCountry,
      productCategory: row.productCategory,
      ownerName: row.ownerName,
      developerName: row.developerName,
      spuId: row.spuId,
      spuCode: row.spuCode,
      spuName: row.spuName,
      externalCode: row.externalCode,
      skuKind: row.skuKind,
      divisionCode: row.divisionCode,
      divisionName: row.divisionName,
      encodingValid: row.encodingValid,
      merchantCode: row.merchantCode,
      merchantName: row.merchantName,
      leadTimeDays: row.leadTimeDays,
      moq: row.moq,
      unitCost: row.unitCost,
      replenishLight: normalizeReplenishLight(row.replenishLight),
      ...readSkuPackagingFromEncodingMeta(row.encodingMeta),
      updatedAt: pickLatestIso(
        row.skuUpdatedAt,
        row.inventoryUpdatedAt,
        readTurnoverSnapshotAt(row.encodingMeta),
      ),
      supplierCount: row.supplierCount,
      isActive: row.isActive,
    })),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});
