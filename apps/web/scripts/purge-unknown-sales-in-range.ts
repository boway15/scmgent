/**
 * 删除飞书长表覆盖日期内 channel=UNKNOWN 的日销/月销，供渠道目录切换后重导。
 *
 * 发布顺序：
 * 1. 先部署别名与 0128 迁移。
 * 2. 拉一次飞书日销长表，用返回 dates 的最小/最大作为 --from / --to。长表没有的更早日期不删。
 * 3. 带 --apply 执行本脚本。
 * 4. 立刻再跑一次飞书日销同步。未登记名字重新成为 UNKNOWN；Wayfair 等写成标准码；月表由导入末尾聚合写回。
 * 5. 然后才生成新预测版本。
 *
 * 定时同步若在删除前又写入混杂的 UNKNOWN，以最后一次「删除后再同步」为准。
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/purge-unknown-sales-in-range.ts --from YYYY-MM-DD --to YYYY-MM-DD
 *   pnpm --filter @scm/web exec tsx scripts/purge-unknown-sales-in-range.ts --from YYYY-MM-DD --to YYYY-MM-DD --apply
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly } from '@scm/db';
import { DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS } from '../server/lib/sales-history-monthly.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseArgs(): { from: string; to: string; apply: boolean } {
  const from = argValue('--from')?.trim();
  const to = argValue('--to')?.trim();
  const apply = process.argv.includes('--apply');
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    console.error('Usage: --from YYYY-MM-DD --to YYYY-MM-DD [--apply]');
    process.exit(1);
  }
  if (from > to) {
    console.error(`Invalid range: --from ${from} is after --to ${to}`);
    process.exit(1);
  }
  return { from, to, apply };
}

/** 今天往前 lookback 个自然月的月初（UTC），与月表默认回看对齐 */
function monthlyLookbackCutoff(now = new Date(), lookback = DEFAULT_MONTHLY_HISTORY_LOOKBACK_MONTHS): {
  year: number;
  month: number;
} {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookback, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthKey(year: number, month: number): number {
  return year * 100 + month;
}

async function main() {
  const { from, to, apply } = parseArgs();
  const lookback = monthlyLookbackCutoff();
  const fromParts = from.split('-').map(Number);
  const toParts = to.split('-').map(Number);
  const fromYm = monthKey(fromParts[0]!, fromParts[1]!);
  const toYm = monthKey(toParts[0]!, toParts[1]!);
  const lookbackYm = monthKey(lookback.year, lookback.month);

  const dailyWhere = and(
    eq(salesHistory.channel, 'UNKNOWN'),
    gte(salesHistory.saleDate, from),
    lte(salesHistory.saleDate, to),
  );

  const monthlyWhere = and(
    eq(salesHistoryMonthly.channel, 'UNKNOWN'),
    sql`(${salesHistoryMonthly.saleYear} * 100 + ${salesHistoryMonthly.month}) >= ${Math.max(fromYm, lookbackYm)}`,
    sql`(${salesHistoryMonthly.saleYear} * 100 + ${salesHistoryMonthly.month}) <= ${toYm}`,
  );

  const [dailyCountRow] = await db.select({ n: count() }).from(salesHistory).where(dailyWhere);
  const [monthlyCountRow] = await db
    .select({ n: count() })
    .from(salesHistoryMonthly)
    .where(monthlyWhere);

  const dailyCount = Number(dailyCountRow?.n ?? 0);
  const monthlyCount = Number(monthlyCountRow?.n ?? 0);

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        from,
        to,
        monthlyLookbackFrom: `${lookback.year}-${String(lookback.month).padStart(2, '0')}`,
        dailyUnknownRows: dailyCount,
        monthlyUnknownRows: monthlyCount,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to delete.');
    return;
  }

  const deletedDaily = await db.delete(salesHistory).where(dailyWhere).returning({ id: salesHistory.id });
  const deletedMonthly = await db
    .delete(salesHistoryMonthly)
    .where(monthlyWhere)
    .returning({ id: salesHistoryMonthly.id });

  console.log(
    JSON.stringify(
      {
        deletedDailyRows: deletedDaily.length,
        deletedMonthlyRows: deletedMonthly.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
