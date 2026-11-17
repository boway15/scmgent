import {
  LIST_COLUMN_WIDTH_MAX,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

export const REORDER_SUGGESTIONS_COLUMN_WIDTHS_KEY =
  'scm.reorder-suggestions.column-widths-v2';

const DEFAULTS: Record<string, number> = {
  fulfillmentRegion: 88,
  platform: 96,
  warehouseCode: 100,
  skuCode: 120,
  merchant: 120,
  healthStatus: 80,
  suggestedDate: 120,
  stockoutDate: 112,
  coverageDays: 88,
  suggestedQty: 88,
  demandSource: 96,
  explain: 160,
  status: 100,
};

export function defaultReorderSuggestionsColumnWidth(columnId: string): number {
  return DEFAULTS[columnId] ?? 112;
}

export function loadReorderSuggestionsColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(REORDER_SUGGESTIONS_COLUMN_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveReorderSuggestionsColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(REORDER_SUGGESTIONS_COLUMN_WIDTHS_KEY, widths);
}
