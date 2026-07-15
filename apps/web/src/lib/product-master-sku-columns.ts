import {
  clampColumnWidth,
  loadStoredColumnWidths,
  saveStoredColumnWidths,
} from '@/lib/column-width-storage';

export type ProductMasterSkuColumnDef = {
  id: string;
  label: string;
  excelCol?: string;
  kind: 'text' | 'numeric' | 'mono' | 'updatedAt' | 'replenishLight' | 'actions';
};

/** 横向滚动时冻结的首列 */
export const PRODUCT_MASTER_FROZEN_COLUMN_ID = 'code';

export const PRODUCT_MASTER_SKU_COLUMNS: ProductMasterSkuColumnDef[] = [
  { id: 'code', label: 'SKU', excelCol: 'B', kind: 'mono' },
  { id: 'name', label: 'SKU名称', excelCol: 'D', kind: 'text' },
  { id: 'category', label: '品类', excelCol: 'A', kind: 'text' },
  { id: 'lifecycle', label: '生命周期', excelCol: 'C', kind: 'text' },
  { id: 'salesCountry', label: '销售国家', excelCol: 'E', kind: 'text' },
  { id: 'productCategory', label: '产品分类', excelCol: 'F', kind: 'text' },
  { id: 'merchantCode', label: '供应商编码', excelCol: 'G', kind: 'mono' },
  { id: 'ownerName', label: '负责人', excelCol: 'H', kind: 'text' },
  { id: 'developerName', label: '开发人员', excelCol: 'I', kind: 'text' },
  { id: 'merchantName', label: '供应商简称', excelCol: 'J', kind: 'text' },
  { id: 'leadTimeDays', label: '采购周期', excelCol: 'K', kind: 'numeric' },
  { id: 'packDimensionsCm', label: '包装长宽高cm', kind: 'text' },
  { id: 'volumeM3', label: '体积（m3）', kind: 'numeric' },
  { id: 'grossWeightKg', label: '毛重（Kg）', kind: 'numeric' },
  { id: 'updatedAt', label: '更新时间', kind: 'updatedAt' },
  { id: 'replenishLight', label: '亮灯', kind: 'replenishLight' },
  { id: 'actions', label: '操作', kind: 'actions' },
];

export const PRODUCT_MASTER_SKU_COLUMN_WIDTHS_KEY = 'scm.product-master.sku-column-widths-v1';

export function defaultProductMasterSkuColumnWidth(columnId: string): number {
  switch (columnId) {
    case 'code':
    case 'merchantCode':
      return 112;
    case 'name':
      return 168;
    case 'category':
      return 140;
    case 'productCategory':
    case 'merchantName':
      return 104;
    case 'packDimensionsCm':
      return 128;
    case 'updatedAt':
      return 156;
    case 'replenishLight':
    case 'actions':
      return 72;
    case 'leadTimeDays':
    case 'volumeM3':
    case 'grossWeightKg':
    case 'lifecycle':
    case 'salesCountry':
    case 'ownerName':
    case 'developerName':
      return 88;
    default:
      return 120;
  }
}

export function loadProductMasterSkuColumnWidths(): Record<string, number> {
  return loadStoredColumnWidths(PRODUCT_MASTER_SKU_COLUMN_WIDTHS_KEY);
}

export function saveProductMasterSkuColumnWidths(widths: Record<string, number>): void {
  saveStoredColumnWidths(PRODUCT_MASTER_SKU_COLUMN_WIDTHS_KEY, widths);
}

export function getProductMasterSkuColumnWidth(
  columnId: string,
  widths: Record<string, number>,
): number {
  return widths[columnId] ?? defaultProductMasterSkuColumnWidth(columnId);
}

export { clampColumnWidth };
