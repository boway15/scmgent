import {
  clampColumnWidth,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';
import {
  isNumericOverviewColumn,
  isWideOverviewColumn,
} from '@/lib/inventory-overview-cell-value';

export const COLUMN_WIDTHS_STORAGE_KEY = 'scm.inventory-overview.column-widths-v1';

export { clampColumnWidth };

export function defaultOverviewColumnWidth(columnId: string): number {
  if (columnId === 'replenishLight' || columnId === 'ai') return 72;
  if (columnId === 'updatedAt') return 156;
  if (columnId === 'dataSource') return 88;
  if (columnId === 'inventoryRecordedDate') return 120;
  if (columnId === '品类') return 96;
  if (isWideOverviewColumn(columnId)) return 200;
  if (isNumericOverviewColumn(columnId)) return 88;
  if (columnId === 'SKU' || columnId === '供应商编码') return 112;
  if (columnId === 'SKU名称' || columnId === '品名') return 160;
  return 120;
}

export function loadOverviewColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(COLUMN_WIDTHS_STORAGE_KEY);
}

export function saveOverviewColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(COLUMN_WIDTHS_STORAGE_KEY, widths);
}

export function clearOverviewColumnWidths(): void {
  localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
}
