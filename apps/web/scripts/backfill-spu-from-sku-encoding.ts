/**
 * 按 SKU 编码规则重新关联 SPU（修复如 WFDJ505212_1 被误建为独立 SPU 的历史数据）。
 * Usage: pnpm exec tsx scripts/backfill-spu-from-sku-encoding.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, skus, spus } from '@scm/db';
import { ensureSpuFromSkuEncoding } from '../server/lib/spu-from-sku.js';
import { parseSkuCode, skuEncodingToColumns } from '../server/lib/sku-encoding.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

async function main() {
  const rows = await db
    .select({
      id: skus.id,
      code: skus.code,
      name: skus.name,
      category: skus.category,
      spuId: skus.spuId,
      moq: skus.moq,
    })
    .from(skus);

  console.log(`待检查 SKU: ${rows.length}`);
  let relinked = 0;
  const orphanSpuIds = new Set<string>();

  for (const row of rows) {
    const parse = parseSkuCode(row.code);
    if (!parse.valid || !parse.spuCode || parse.spuCode === row.code) continue;

    let currentSpuCode: string | null = null;
    if (row.spuId) {
      const [spu] = await db
        .select({ id: spus.id, code: spus.code })
        .from(spus)
        .where(eq(spus.id, row.spuId))
        .limit(1);
      currentSpuCode = spu?.code ?? null;
      if (currentSpuCode === parse.spuCode) continue;
      if (spu) orphanSpuIds.add(spu.id);
    }

    const { spuId } = await ensureSpuFromSkuEncoding(row.code, undefined, {
      name: row.name,
      category: row.category ?? undefined,
      moq: row.moq ?? undefined,
    });
    if (!spuId || spuId === row.spuId) continue;

    await db
      .update(skus)
      .set({
        spuId,
        ...skuEncodingToColumns(parse),
        updatedAt: new Date(),
      })
      .where(eq(skus.id, row.id));

    relinked++;
    console.log(`  ${row.code}: ${currentSpuCode ?? '(无)'} -> ${parse.spuCode}`);
  }

  let deletedSpus = 0;
  if (orphanSpuIds.size) {
    for (const spuId of orphanSpuIds) {
      const linked = await db
        .select({ id: skus.id })
        .from(skus)
        .where(eq(skus.spuId, spuId))
        .limit(1);
      if (linked.length) continue;

      await db.delete(spus).where(eq(spus.id, spuId));
      deletedSpus++;
    }
  }

  console.log(`已重关联 SKU: ${relinked}`);
  console.log(`已删除孤立 SPU: ${deletedSpus}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
