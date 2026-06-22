import { eq, and } from 'drizzle-orm';
import { db, skus, merchants, skuSuppliers } from '@scm/db';

/** 将默认供货商家同步到 skus.merchant_code / merchant_name（兼容 PMC、补货逻辑） */
export async function syncSkuDefaultMerchant(skuId: string): Promise<void> {
  const [link] = await db
    .select({
      merchantCode: merchants.code,
      merchantName: merchants.name,
      unitPrice: skuSuppliers.unitPrice,
      leadTimeDays: skuSuppliers.leadTimeDays,
      moq: skuSuppliers.moq,
    })
    .from(skuSuppliers)
    .innerJoin(merchants, eq(merchants.id, skuSuppliers.merchantId))
    .where(and(eq(skuSuppliers.skuId, skuId), eq(skuSuppliers.isDefault, true), eq(skuSuppliers.isActive, true)))
    .limit(1);

  if (!link) {
    await db
      .update(skus)
      .set({ merchantCode: null, merchantName: null, updatedAt: new Date() })
      .where(eq(skus.id, skuId));
    return;
  }

  await db
    .update(skus)
    .set({
      merchantCode: link.merchantCode,
      merchantName: link.merchantName,
      unitCost: link.unitPrice ?? undefined,
      leadTimeDays: link.leadTimeDays ?? undefined,
      moq: link.moq ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(skus.id, skuId));
}

export async function setDefaultSkuSupplier(skuId: string, supplierId: string): Promise<void> {
  await db.update(skuSuppliers).set({ isDefault: false, updatedAt: new Date() }).where(eq(skuSuppliers.skuId, skuId));
  await db
    .update(skuSuppliers)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(skuSuppliers.id, supplierId), eq(skuSuppliers.skuId, skuId)));
  await syncSkuDefaultMerchant(skuId);
}

export async function resolveMerchantByCode(code: string): Promise<{ id: string; code: string; name: string } | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const [row] = await db.select().from(merchants).where(eq(merchants.code, trimmed)).limit(1);
  return row ? { id: row.id, code: row.code, name: row.name } : null;
}

export async function upsertSkuSupplierFromImport(
  skuId: string,
  merchantCode: string,
  merchantName: string | undefined,
  opts: { unitPrice?: string; leadTimeDays?: number; moq?: number },
): Promise<void> {
  let merchant = await resolveMerchantByCode(merchantCode);
  if (!merchant) {
    const [created] = await db
      .insert(merchants)
      .values({
        code: merchantCode.trim(),
        name: merchantName?.trim() || merchantCode.trim(),
        isActive: true,
        updatedAt: new Date(),
      })
      .returning();
    merchant = { id: created.id, code: created.code, name: created.name };
  }

  const [existing] = await db
    .select()
    .from(skuSuppliers)
    .where(and(eq(skuSuppliers.skuId, skuId), eq(skuSuppliers.merchantId, merchant.id)))
    .limit(1);

  if (existing) {
    await db
      .update(skuSuppliers)
      .set({
        unitPrice: opts.unitPrice ?? existing.unitPrice,
        leadTimeDays: opts.leadTimeDays ?? existing.leadTimeDays,
        moq: opts.moq ?? existing.moq,
        isDefault: true,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(skuSuppliers.id, existing.id));
  } else {
    await db.update(skuSuppliers).set({ isDefault: false, updatedAt: new Date() }).where(eq(skuSuppliers.skuId, skuId));
    await db.insert(skuSuppliers).values({
      skuId,
      merchantId: merchant.id,
      unitPrice: opts.unitPrice,
      leadTimeDays: opts.leadTimeDays,
      moq: opts.moq,
      isDefault: true,
      isActive: true,
    });
  }

  await syncSkuDefaultMerchant(skuId);
}
