import {
  salesHistoryDailyRetentionDays,
  salesImportMinSaleDate,
} from './sales-history-config.js';

/** 上线后增量导入默认分界日（与业务约定一致，可通过 SALES_IMPORT_MIN_DATE 覆盖） */
export const SALES_INCREMENTAL_CUTOFF_DEFAULT = '2026-01-01';

export type SalesImportPolicy = {
  /** full_init：展开宽表全部日期列；incremental：仅展开 importMinSaleDate 及之后 */
  mode: 'full_init' | 'incremental';
  importMinSaleDate: string | null;
  recommendedIncrementalDate: string;
  dailyRetentionDays: number;
  isProduction: boolean;
};

export function getSalesImportPolicy(): SalesImportPolicy {
  const importMinSaleDate = salesImportMinSaleDate() ?? null;
  return {
    mode: importMinSaleDate ? 'incremental' : 'full_init',
    importMinSaleDate,
    recommendedIncrementalDate: SALES_INCREMENTAL_CUTOFF_DEFAULT,
    dailyRetentionDays: salesHistoryDailyRetentionDays(),
    isProduction: process.env.NODE_ENV === 'production',
  };
}
