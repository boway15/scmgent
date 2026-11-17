import {
  LIST_COLUMN_WIDTH_MAX,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

/** v3：重建默认列宽与布局模型，废弃 v1/v2 错位缓存 */
export const SALES_HISTORY_DAILY_WIDTHS_KEY = 'scm.sales-history.daily-column-widths-v3';
export const SALES_HISTORY_MONTHLY_WIDTHS_KEY = 'scm.sales-history.monthly-column-widths-v3';

const DAILY_DEFAULTS: Record<string, number> = {
  saleDate: 110,
  skuCode: 132,
  skuName: 220,
  category: 180,
  qtySold: 72,
  station: 140,
  salesRegion: 72,
  channel: 104,
  warehouseCode: 96,
  source: 72,
};

const MONTHLY_DEFAULTS: Record<string, number> = {
  saleMonth: 110,
  skuCode: 132,
  skuName: 220,
  category: 180,
  qtySold: 88,
  channel: 104,
  source: 72,
};

export function defaultSalesHistoryDailyColumnWidth(columnId: string): number {
  return DAILY_DEFAULTS[columnId] ?? 120;
}

export function defaultSalesHistoryMonthlyColumnWidth(columnId: string): number {
  return MONTHLY_DEFAULTS[columnId] ?? 120;
}

export function loadSalesHistoryDailyColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(SALES_HISTORY_DAILY_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveSalesHistoryDailyColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(SALES_HISTORY_DAILY_WIDTHS_KEY, widths);
}

export function loadSalesHistoryMonthlyColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(SALES_HISTORY_MONTHLY_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveSalesHistoryMonthlyColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(SALES_HISTORY_MONTHLY_WIDTHS_KEY, widths);
}
