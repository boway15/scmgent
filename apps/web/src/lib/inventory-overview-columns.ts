import { TURNOVER_IMPORT_HEADERS } from './inventory-turnover-headers';
import { getViewColumnIds } from './inventory-overview-views';

export type OverviewColumnDef = {
  id: string;
  label: string;
  group: string;
  kind: 'meta' | 'sheet' | 'ops';
  excelCol?: string;
  defaultVisible: boolean;
};

function inferTurnoverHeaderGroup(header: string): string {
  if (header.includes('销售占比')) return '销售占比';
  if (header.startsWith('海外仓库存')) return '海外仓库存';
  if (header.includes('预计') && header.includes('上架')) return '预计上架';
  if (header.startsWith('调拨在途')) return '调拨在途';
  if (header.includes('供应商订单')) return '供应商订单';
  if (header.startsWith('已调拨未在途')) return '已调拨未在途';
  if (header === '预下单' || header === '全链条合计库存') return '库存汇总';
  if (header.endsWith('销量') || header.includes('月销量')) return '销量';
  if (header.includes('预测日均')) return '预测日均';
  if (header.includes('周转')) return '周转天数';
  if (header.includes('断货') || header.includes('上架时间') || header.includes('最早上架')) {
    return '断货与上架';
  }
  if (
    header.includes('毛利率') ||
    header.includes('退款率') ||
    header.includes('包装') ||
    header.includes('体积') ||
    header.includes('毛重')
  ) {
    return '包装与毛利';
  }
  if (header === '币种') return '主数据扩展';
  return '其他';
}

function excelColumnLabel(index: number): string {
  let n = index;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

const META_COLUMNS: OverviewColumnDef[] = [
  { id: 'updatedAt', label: '更新时间', group: '更新信息', kind: 'meta', defaultVisible: true },
  { id: 'dataSource', label: '数据来源', group: '更新信息', kind: 'meta', defaultVisible: true },
  {
    id: 'inventoryRecordedDate',
    label: '库存快照日期',
    group: '更新信息',
    kind: 'meta',
    defaultVisible: false,
  },
];

const SHEET_COLUMNS: OverviewColumnDef[] = TURNOVER_IMPORT_HEADERS.map((header, index) => ({
  id: header,
  label: header,
  group: inferTurnoverHeaderGroup(header),
  kind: 'sheet' as const,
  excelCol: excelColumnLabel(index + 1),
  defaultVisible: false,
}));

const OPS_COLUMNS: OverviewColumnDef[] = [
  { id: 'replenishLight', label: '补货灯', group: '运营', kind: 'ops', defaultVisible: true },
  { id: 'ai', label: 'AI', group: '运营', kind: 'ops', defaultVisible: true },
];

export const INVENTORY_OVERVIEW_COLUMNS: OverviewColumnDef[] = [
  ...META_COLUMNS,
  ...SHEET_COLUMNS,
  ...OPS_COLUMNS,
];

export const TURNOVER_SHEET_COLUMN_COUNT = TURNOVER_IMPORT_HEADERS.length;

/** 默认补货日常视图列 */
export function getDefaultVisibleColumnIds(): string[] {
  return getViewColumnIds('replenish');
}

export const INVENTORY_OVERVIEW_COLUMN_BY_ID = new Map(
  INVENTORY_OVERVIEW_COLUMNS.map((col) => [col.id, col]),
);

export { loadInitialViewState, loadCustomColumnIds, saveCustomColumnIds } from './inventory-overview-views';

const DATA_SOURCE_LABEL: Record<string, string> = {
  import: '导入',
  manual: '手工维护',
  pmc_receipt: 'PMC收货',
};

import { formatDateTimeCst } from '@/lib/utils';

export function formatOverviewUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const formatted = formatDateTimeCst(iso);
  return formatted === '—' ? iso : formatted;
}

export function formatOverviewDataSource(source: string | null | undefined): string {
  if (!source) return '-';
  return DATA_SOURCE_LABEL[source] ?? source;
}

export function mergeColumnCatalog(
  apiColumns?: OverviewColumnDef[],
): OverviewColumnDef[] {
  if (!apiColumns?.length) return INVENTORY_OVERVIEW_COLUMNS;
  const byId = new Map(INVENTORY_OVERVIEW_COLUMNS.map((col) => [col.id, col]));
  return apiColumns.map((col) => ({ ...byId.get(col.id), ...col }));
}
