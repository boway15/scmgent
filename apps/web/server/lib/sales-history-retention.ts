/**
 * 日表滚动保留：月表已聚合的历史日明细可裁剪，控制日表规模。
 */
import { sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { salesHistoryDailyRetentionCutoff } from './sales-history-config.js';

const DELETE_BATCH = 50_000;

export type PruneDailySalesResult = {
  deletedRows: number;
  cutoffDate: string;
  batches: number;
};

export async function pruneSalesHistoryDailyBeyondRetention(): Promise<PruneDailySalesResult> {
  const cutoffDate = salesHistoryDailyRetentionCutoff();
  let deletedRows = 0;
  let batches = 0;

  while (true) {
    const result = await db.execute(sql`
      WITH del AS (
        DELETE FROM sales_history
        WHERE id IN (
          SELECT id FROM sales_history
          WHERE sale_date < ${cutoffDate}
          LIMIT ${DELETE_BATCH}
        )
        RETURNING id
      )
      SELECT count(*)::int AS deleted FROM del
    `);
    const rows = Array.from(result as unknown as Array<{ deleted: number }>);
    const count = Number(rows[0]?.deleted ?? 0);
    deletedRows += count;
    batches += 1;
    if (count < DELETE_BATCH) break;
    if (batches > 500) break;
  }

  return { deletedRows, cutoffDate, batches };
}
