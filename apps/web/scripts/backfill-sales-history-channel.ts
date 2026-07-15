/**
 * 将 sales_history / sales_history_monthly 的 channel 归一化为标准平台编码。
 * Usage: pnpm exec tsx scripts/backfill-sales-history-channel.ts [--dry-run]
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, salesHistory, salesHistoryMonthly } from '@scm/db';
import { resolveSalesPlatformCode } from '../server/lib/sales-platform.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const dryRun = process.argv.includes('--dry-run');

async function normalizeChannel(raw: string): Promise<string> {
  const code = await resolveSalesPlatformCode(raw);
  return code ?? 'UNKNOWN';
}

async function backfillDailyChannels() {
  const distinct = await db
    .selectDistinct({ channel: salesHistory.channel })
    .from(salesHistory);

  let updated = 0;
  let merged = 0;

  for (const row of distinct) {
    const raw = row.channel ?? 'UNKNOWN';
    const normalized = await normalizeChannel(raw);
    if (normalized === raw) continue;

    if (dryRun) {
      console.log(`[dry-run] sales_history: ${raw} -> ${normalized}`);
      updated++;
      continue;
    }

    const rows = await db
      .select({
        id: salesHistory.id,
        skuId: salesHistory.skuId,
        saleDate: salesHistory.saleDate,
        qtySold: salesHistory.qtySold,
      })
      .from(salesHistory)
      .where(eq(salesHistory.channel, raw));

    for (const existing of rows) {
      const [target] = await db
        .select({ id: salesHistory.id, qtySold: salesHistory.qtySold })
        .from(salesHistory)
        .where(
          and(
            eq(salesHistory.skuId, existing.skuId),
            eq(salesHistory.saleDate, existing.saleDate),
            eq(salesHistory.channel, normalized),
          ),
        )
        .limit(1);

      if (target) {
        await db
          .update(salesHistory)
          .set({ qtySold: target.qtySold + existing.qtySold })
          .where(eq(salesHistory.id, target.id));
        await db.delete(salesHistory).where(eq(salesHistory.id, existing.id));
        merged++;
      } else {
        await db
          .update(salesHistory)
          .set({ channel: normalized })
          .where(eq(salesHistory.id, existing.id));
        updated++;
      }
    }
  }

  return { updated, merged };
}

async function backfillMonthlyChannels() {
  const distinct = await db
    .selectDistinct({ channel: salesHistoryMonthly.channel })
    .from(salesHistoryMonthly);

  let updated = 0;
  let merged = 0;

  for (const row of distinct) {
    const raw = row.channel ?? 'UNKNOWN';
    const normalized = await normalizeChannel(raw);
    if (normalized === raw) continue;

    if (dryRun) {
      console.log(`[dry-run] sales_history_monthly: ${raw} -> ${normalized}`);
      updated++;
      continue;
    }

    const rows = await db
      .select({
        id: salesHistoryMonthly.id,
        skuId: salesHistoryMonthly.skuId,
        saleYear: salesHistoryMonthly.saleYear,
        month: salesHistoryMonthly.month,
        qtySold: salesHistoryMonthly.qtySold,
      })
      .from(salesHistoryMonthly)
      .where(eq(salesHistoryMonthly.channel, raw));

    for (const existing of rows) {
      const [target] = await db
        .select({ id: salesHistoryMonthly.id, qtySold: salesHistoryMonthly.qtySold })
        .from(salesHistoryMonthly)
        .where(
          and(
            eq(salesHistoryMonthly.skuId, existing.skuId),
            eq(salesHistoryMonthly.saleYear, existing.saleYear),
            eq(salesHistoryMonthly.month, existing.month),
            eq(salesHistoryMonthly.channel, normalized),
          ),
        )
        .limit(1);

      if (target) {
        await db
          .update(salesHistoryMonthly)
          .set({
            qtySold: target.qtySold + existing.qtySold,
            updatedAt: new Date(),
          })
          .where(eq(salesHistoryMonthly.id, target.id));
        await db.delete(salesHistoryMonthly).where(eq(salesHistoryMonthly.id, existing.id));
        merged++;
      } else {
        await db
          .update(salesHistoryMonthly)
          .set({ channel: normalized, updatedAt: new Date() })
          .where(eq(salesHistoryMonthly.id, existing.id));
        updated++;
      }
    }
  }

  return { updated, merged };
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes' : 'Backfilling sales channel codes...');
  const daily = await backfillDailyChannels();
  const monthly = await backfillMonthlyChannels();
  console.log(
    JSON.stringify(
      {
        dryRun,
        salesHistory: daily,
        salesHistoryMonthly: monthly,
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
