import { eq } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { recordToolCall } from '../trace.js';

export type SkuLookupInput = {
  skuId?: string;
  skuCode?: string;
};

export async function resolveSkuId(input: SkuLookupInput): Promise<string | null> {
  if (input.skuId) return input.skuId;
  if (!input.skuCode?.trim()) return null;
  const [row] = await db
    .select({ id: skus.id })
    .from(skus)
    .where(eq(skus.code, input.skuCode.trim()))
    .limit(1);
  return row?.id ?? null;
}

export async function getSkuInfo(input: SkuLookupInput, runId?: string) {
  const handler = async () => {
    const id = await resolveSkuId(input);
    if (!id) return null;
    const [sku] = await db.select().from(skus).where(eq(skus.id, id)).limit(1);
    if (!sku) return null;
    return {
      id: sku.id,
      code: sku.code,
      name: sku.name,
      leadTimeDays: sku.leadTimeDays,
      merchantCode: sku.merchantCode,
      merchantName: sku.merchantName,
      replenishLight: sku.replenishLight,
    };
  };

  if (runId) {
    return recordToolCall(runId, 'getSkuInfo', handler, input);
  }
  return handler();
}
