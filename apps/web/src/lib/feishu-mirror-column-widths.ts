import {
  LIST_COLUMN_WIDTH_MAX,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

export const INVENTORY_QUERY_COLUMN_WIDTHS_KEY = 'scm.inventory-query.column-widths-v3';
export const PROCUREMENT_OPS_COLUMN_WIDTHS_KEY = 'scm.procurement-ops.column-widths-v3';

const SKU_LIKE = /^(SKU|sku|商品编码)/i;

export function defaultFeishuMirrorColumnWidth(columnId: string): number {
  if (SKU_LIKE.test(columnId)) return 112;
  if (/名称|品名/.test(columnId)) return 160;
  if (/品类|分类/.test(columnId)) return 120;
  if (/数量|库存|销量|在途|可售/.test(columnId)) return 96;
  return 128;
}

export function loadInventoryQueryColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(INVENTORY_QUERY_COLUMN_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveInventoryQueryColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(INVENTORY_QUERY_COLUMN_WIDTHS_KEY, widths);
}

export function loadProcurementOpsColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(PROCUREMENT_OPS_COLUMN_WIDTHS_KEY, LIST_COLUMN_WIDTH_MAX);
}

export function saveProcurementOpsColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(PROCUREMENT_OPS_COLUMN_WIDTHS_KEY, widths);
}

/** 镜像表单元格展示口径（三表统一） */
export function feishuMirrorCellClass(columnId: string, raw: string): string {
  const value = raw.trim();
  if (!value || value === '—') return 'text-text-hint';
  if (SKU_LIKE.test(columnId)) return 'font-mono text-primary';
  if (/数量|库存|销量|在途|可售|合计|占比/.test(columnId) || /^-?\d+([.,]\d+)?%?$/.test(value)) {
    return 'font-numeric tabular-nums text-text-main';
  }
  if (/编码|仓|国家|区域|平台|渠道/i.test(columnId)) {
    return 'font-mono text-text-sub';
  }
  return 'text-text-main';
}
