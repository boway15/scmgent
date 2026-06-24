import { eq } from 'drizzle-orm';
import { db, spus } from '@scm/db';
import {
  parseSkuCode,
  spuFieldsFromParse,
  type SkuParseResult,
} from './sku-encoding.js';

export type EnsureSpuOptions = {
  name: string;
  moq?: number;
  category?: string;
  /** 手工指定 SPU code，优先于编码推导 */
  spuCodeOverride?: string;
};

/**
 * 根据 SKU 编码解析结果自动创建或更新 SPU，返回 spuId。
 * legacy 编码时回退到 spuCodeOverride 或 sku code。
 */
export async function ensureSpuFromSkuEncoding(
  skuCode: string,
  externalCode: string | undefined,
  opts: EnsureSpuOptions,
): Promise<{ spuId: string | null; parse: SkuParseResult; spuCode: string | null }> {
  const parse = parseSkuCode(skuCode, externalCode);
  const derived = spuFieldsFromParse(parse, opts.name, {
    moq: opts.moq,
    category: opts.category,
  });

  const spuCode =
    opts.spuCodeOverride?.trim() ||
    derived?.code ||
    parse.spuCode ||
    skuCode.trim();

  if (!spuCode) {
    return { spuId: null, parse, spuCode: null };
  }

  const [existing] = await db.select().from(spus).where(eq(spus.code, spuCode)).limit(1);

  if (existing) {
    if (derived) {
      const patch: Record<string, unknown> = {
        divisionCode: derived.divisionCode,
        distributionNo: derived.distributionNo,
        spuNumericCode: derived.spuNumericCode,
        brandCode: derived.brandCode,
        categoryCode: derived.categoryCode,
        divisionName: derived.divisionName,
        encodingSource: 'sku_derived',
        updatedAt: new Date(),
      };
      if (opts.moq != null && opts.moq > 0) patch.moq = opts.moq;
      await db.update(spus).set(patch).where(eq(spus.id, existing.id));
    } else if (opts.moq != null && opts.moq > 0 && existing.moq !== opts.moq) {
      await db
        .update(spus)
        .set({ moq: opts.moq, updatedAt: new Date() })
        .where(eq(spus.id, existing.id));
    }
    return { spuId: existing.id, parse, spuCode };
  }

  const insertValues = derived ?? {
    code: spuCode,
    name: opts.name,
    category: opts.category,
    moq: opts.moq,
    encodingSource: 'manual',
  };

  const [created] = await db
    .insert(spus)
    .values({
      ...insertValues,
      name: (insertValues.name as string) || opts.name,
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  return { spuId: created.id, parse, spuCode };
}
