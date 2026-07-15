import { aggregateSalesHistoryMonthlyFromDaily } from '../lib/sales-history-monthly.js';
import { pruneSalesHistoryDailyBeyondRetention } from '../lib/sales-history-retention.js';

export type SalesHistoryMaintenanceResult = {
  monthlyUpserted: number;
  prunedDailyRows: number;
  dailyRetentionCutoff: string;
};

/** 月表全量重聚合 + 日表滚动裁剪（可手动触发或定时）。 */
export async function runSalesHistoryMaintenance(): Promise<SalesHistoryMaintenanceResult> {
  const monthly = await aggregateSalesHistoryMonthlyFromDaily({ lookbackMonths: 'all' });
  const prune = await pruneSalesHistoryDailyBeyondRetention();
  return {
    monthlyUpserted: monthly.upsertedRows,
    prunedDailyRows: prune.deletedRows,
    dailyRetentionCutoff: prune.cutoffDate,
  };
}
