import type { InventoryTurnoverOverviewItem } from './inventory-overview-service.js';
import {
  TURNOVER_GROSS_WEIGHT_HEADER,
  TURNOVER_GROSS_WEIGHT_HEADER_EXCEL,
  TURNOVER_PACK_DIMENSIONS_HEADER,
  TURNOVER_VOLUME_HEADER,
  TURNOVER_VOLUME_HEADER_EXCEL,
} from './inventory-turnover-snapshot.js';
import { formatTurnoverDateValue, isTurnoverDateColumn } from './turnover-date-format.js';

const DATA_SOURCE_LABEL: Record<string, string> = {
  import: '导入',
  manual: '手工维护',
  pmc_receipt: 'PMC收货',
};

function formatOverviewUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatOverviewDataSource(source: string | null | undefined): string {
  if (!source) return '-';
  return DATA_SOURCE_LABEL[source] ?? source;
}

/** Excel 海外仓库存_* → 仓 code（飞书美东等列为销售占比，不映射为库存） */
const COLUMN_TO_WAREHOUSE = new Map<string, string>([
  ['海外仓库存_美东', 'US-EAST'],
  ['海外仓库存_美南', 'US-SOUTH'],
  ['海外仓库存_美西', 'US-WEST'],
  ['海外仓库存_美中', 'US-CENTRAL'],
  ['海外仓库存_美东南', 'US-SOUTHEAST'],
  ['海外仓库存_德国', 'DE'],
  ['海外仓库存_平台仓_美', 'PLATFORM-US'],
  ['海外仓库存_平台仓_欧', 'PLATFORM-EU'],
]);

function isTurnoverInventoryQuantityColumn(columnId: string): boolean {
  return (
    COLUMN_TO_WAREHOUSE.has(columnId) ||
    columnId === '海外仓在库' ||
    columnId === '海外仓库存_合计' ||
    columnId === '调拨在途合计' ||
    columnId === '调拨在途_合计' ||
    columnId === '已调拨未在途' ||
    columnId === '已调拨未在途_合计' ||
    columnId.includes('供应商订单') ||
    columnId === '预下单' ||
    columnId === '全链条合计库存' ||
    (columnId.startsWith('预计') && columnId.includes('上架'))
  );
}

function warehouseStockToColumnValue(
  item: InventoryTurnoverOverviewItem,
  columnId: string,
): string | null {
  const stocks = item.warehouseStocks;
  if (!stocks?.length) return null;

  const warehouse = COLUMN_TO_WAREHOUSE.get(columnId);
  if (warehouse) {
    const stock = stocks.find((s) => s.warehouseCode === warehouse);
    if (stock) return String(stock.qtyAvailable);
  }

  if (columnId === '海外仓在库' || columnId === '海外仓库存_合计') {
    const total = stocks.reduce((sum, s) => sum + (s.qtyAvailable ?? 0), 0);
    return String(total);
  }

  return null;
}

export function getOverviewCellValue(
  item: InventoryTurnoverOverviewItem,
  columnId: string,
): string {
  if (columnId === 'updatedAt') return formatOverviewUpdatedAt(item.updatedAt);
  if (columnId === 'dataSource') return formatOverviewDataSource(item.dataSource);
  if (columnId === 'inventoryRecordedDate') return item.inventoryRecordedDate ?? '-';
  if (columnId === 'replenishLight') return item.replenishLight;
  if (columnId === 'ai') return '问 AI';

  const fromSnapshot = item.turnoverExtras?.[columnId];
  if (fromSnapshot !== undefined && fromSnapshot !== '') {
    return formatTurnoverDateValue(columnId, fromSnapshot);
  }

  if (isTurnoverInventoryQuantityColumn(columnId)) {
    const fromWarehouse = warehouseStockToColumnValue(item, columnId);
    if (fromWarehouse != null) return fromWarehouse;
    if (columnId === '供应商订单' || columnId === '供应商订单合计') {
      return String(item.qtyInProduction ?? 0);
    }
    if (columnId === '预下单') return String(item.qtyPreOrder ?? 0);
    return '-';
  }

  switch (columnId) {
    case '品类':
      return item.category ?? '-';
    case 'SKU':
      return item.code;
    case '生命周期':
      return item.lifecycle ?? '-';
    case 'SKU名称':
      return item.name;
    case '销售国家':
      return item.salesCountry ?? '-';
    case '产品分类':
      return item.productCategory ?? '-';
    case '供应商编码':
      return item.merchantCode ?? '-';
    case '负责人':
      return item.ownerName ?? '-';
    case '开发人员':
      return item.developerName ?? '-';
    case '供应商简称':
      return item.merchantName ?? '-';
    case '采购周期':
      return item.leadTimeDays != null ? String(item.leadTimeDays) : '-';
    case '采购价':
      return item.unitCost ?? '-';
    case '3天销量':
      return String(item.salesQty3d ?? 0);
    case '7天销量':
      return String(item.salesQty7d ?? 0);
    case '14天销量':
      return String(item.salesQty14d ?? 0);
    case '30天销量':
      return String(item.salesQty30d ?? 0);
    case TURNOVER_PACK_DIMENSIONS_HEADER:
      return item.packDimensionsCm ?? '-';
    case TURNOVER_VOLUME_HEADER:
    case TURNOVER_VOLUME_HEADER_EXCEL:
      return item.volumeM3 ?? '-';
    case TURNOVER_GROSS_WEIGHT_HEADER:
    case TURNOVER_GROSS_WEIGHT_HEADER_EXCEL:
      return item.grossWeightKg ?? '-';
    default:
      return '-';
  }
}

export function isNumericOverviewColumn(columnId: string): boolean {
  if (isTurnoverDateColumn(columnId)) return false;
  return (
    columnId.includes('销量') ||
    columnId.includes('库存') ||
    columnId.includes('在库') ||
    columnId.includes('在途') ||
    columnId.includes('订单') ||
    columnId.includes('周转') ||
    columnId.includes('毛利率') ||
    columnId.includes('退款率') ||
    columnId.includes('毛重') ||
    columnId.includes('体积') ||
    columnId === '预下单' ||
    columnId === '采购周期' ||
    columnId === '采购价' ||
    COLUMN_TO_WAREHOUSE.has(columnId)
  );
}
