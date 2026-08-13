/**
 * 仅清空销量历史（日表 + 月表 + sales 导入批次），不动库存 / SKU / 其它业务表。
 * Usage:
 *   cd apps/web
 *   pnpm exec tsx scripts/reset-sales-history-only.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly, importBatches } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

async function countTable(table: typeof salesHistory | typeof salesHistoryMonthly | typeof importBatches) {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.count ?? 0;
}

async function main() {
  console.log('=== 仅清空销量历史（不动库存/SKU）===\n');

  const before = {
    salesHistory: await countTable(salesHistory),
    salesHistoryMonthly: await countTable(salesHistoryMonthly),
  };
  console.log('清空前:', before);

  // 大表用 TRUNCATE 更快；CASCADE 仅清引用本表的依赖（若有），不删 skus
  await db.execute(sql`TRUNCATE TABLE sales_history RESTART IDENTITY`);
  console.log('已清空 sales_history');

  await db.execute(sql`TRUNCATE TABLE sales_history_monthly RESTART IDENTITY`);
  console.log('已清空 sales_history_monthly');

  const deletedBatches = await db
    .delete(importBatches)
    .where(eq(importBatches.type, 'sales'))
    .returning({ id: importBatches.id });
  console.log(`已删 import_batches (sales): ${deletedBatches.length}`);

  const after = {
    salesHistory: await countTable(salesHistory),
    salesHistoryMonthly: await countTable(salesHistoryMonthly),
  };
  console.log('\n清空后:', after);
  console.log('完成。请在页面重新导入日销量宽表。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
