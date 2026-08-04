import type { InventoryOverview } from '@/lib/api';
import {
  formatOverviewDataSource,
  formatOverviewUpdatedAt,
} from '@/lib/inventory-overview-columns';
import { formatTurnoverDateValue, isTurnoverDateColumn } from '@/lib/turnover-date-format';

/** 优先飞书快照字段，再回退 SKU 主数据 / Excel 分仓数量（不含销售占比列） */
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
  item: InventoryOverview,
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

/** 优先飞书快照字段，再回退 SKU 主数据 / Excel 分仓数量 */
export function getOverviewCellValue(item: InventoryOverview, columnId: string): string {
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
    case '包装长宽高cm':
      return item.packDimensionsCm ?? item.turnoverExtras?.['包装长宽高cm'] ?? '-';
    case '体积(m3)':
    case '体积（m3）':
      return item.volumeM3 ?? item.turnoverExtras?.['体积(m3)'] ?? item.turnoverExtras?.['体积（m3）'] ?? '-';
    case '毛重(Kg)':
    case '毛重（Kg）':
      return item.grossWeightKg ?? item.turnoverExtras?.['毛重(Kg)'] ?? item.turnoverExtras?.['毛重（Kg）'] ?? '-';
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

export function isWideOverviewColumn(columnId: string): boolean {
  return (
    columnId === '品类' ||
    columnId === 'SKU名称' ||
    columnId === '产品分类' ||
    columnId.includes('上架') ||
    columnId.includes('断货时间')
  );
}
