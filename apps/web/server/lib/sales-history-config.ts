/**
 * 日表 + 月表双轨配置：
 * - 日表：滚动窗口内的动销明细（补货、近 30 天销量等）
 * - 月表：长周期同比、预测准确率、首销日等
 */

/** 增量导入起始日：仅展开宽表中 >= 该日期的列。全量初始化时不设。 */
export function salesImportMinSaleDate(): string | undefined {
  const value = process.env.SALES_IMPORT_MIN_DATE?.trim();
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

/** 日表保留天数（超出部分在月聚合后裁剪）。默认 365。 */
export function salesHistoryDailyRetentionDays(): number {
  const raw = process.env.SALES_HISTORY_DAILY_RETENTION_DAYS?.trim();
  if (!raw) return 365;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 90) return 365;
  return parsed;
}

/** 补货/健康计算读取日表的回溯天数（与 calcDailyStats 默认一致）。 */
export function replenishmentSalesLookbackDays(): number {
  const raw = process.env.REPLENISHMENT_SALES_LOOKBACK_DAYS?.trim();
  if (!raw) return 90;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 30) return 90;
  return parsed;
}

/** 库存总览近 N 天销量窗口（与日表保留无关）。 */
export function inventoryVelocityLookbackDays(): number {
  return 30;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 返回 lookback 天前的日期（UTC 日历日）。 */
export function salesHistoryLookbackCutoff(lookbackDays: number, today = new Date()): string {
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  return toDateOnlyString(cutoff);
}

/** 日表裁剪边界：sale_date 严格小于此日期的行可被删除。 */
export function salesHistoryDailyRetentionCutoff(today = new Date()): string {
  return salesHistoryLookbackCutoff(salesHistoryDailyRetentionDays(), today);
}
