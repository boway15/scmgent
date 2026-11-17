import {
  LIST_COLUMN_WIDTH_MAX,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

export const SAFETY_STOCK_COLUMN_WIDTHS_KEY = 'scm.safety-stock.column-widths-v2';

const DEFAULTS: Record<string, number> = {
  skuCode: 120,
  warehouse: 88,
  configuredDays: 88,
  safetyStockQty: 96,
  reorderPoint: 96,
  reorderQty: 96,
  suggestedDays: 88,
  suggestedQty: 88,
  delta: 88,
  confidence: 72,
  method: 148,
  serviceLevel: 96,
  actions: 200,
};

export function defaultSafetyStockColumnWidth(columnId: string): number {
  return DEFAULTS[columnId] ?? 96;
}

export function loadSafetyStockColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(SAFETY_STOCK_COLUMN_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveSafetyStockColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(SAFETY_STOCK_COLUMN_WIDTHS_KEY, widths);
}
