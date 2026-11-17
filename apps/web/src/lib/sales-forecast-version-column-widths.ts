import {
  LIST_COLUMN_WIDTH_MAX,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

export const SALES_FORECAST_VERSION_COLUMN_WIDTHS_KEY =
  'scm.sales-forecast.version-column-widths-v2';

const DEFAULTS: Record<string, number> = {
  version: 200,
  status: 100,
  horizon: 128,
  counts: 112,
  creator: 100,
  timestamps: 168,
  actions: 200,
};

export function defaultSalesForecastVersionColumnWidth(columnId: string): number {
  return DEFAULTS[columnId] ?? 120;
}

export function loadSalesForecastVersionColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(SALES_FORECAST_VERSION_COLUMN_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveSalesForecastVersionColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(SALES_FORECAST_VERSION_COLUMN_WIDTHS_KEY, widths);
}
