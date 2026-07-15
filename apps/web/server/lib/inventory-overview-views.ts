import { TURNOVER_IMPORT_HEADERS } from './inventory-turnover-headers.js';
import { orderOverviewColumnIds } from './inventory-overview-column-order.js';

export type OverviewViewId = 'replenish' | 'warehouse' | 'stockout' | 'excel_full' | 'custom';

const VALID_COLUMN_IDS = new Set([
  'updatedAt',
  'dataSource',
  'inventoryRecordedDate',
  'replenishLight',
  'ai',
  ...TURNOVER_IMPORT_HEADERS,
]);

const MASTER_DATA_COLS = [
  '品类',
  'SKU',
  '生命周期',
  'SKU名称',
  '销售国家',
  '产品分类',
  '供应商编码',
] as const;

function sheetHeadersMatching(pred: (header: string) => boolean): string[] {
  return [...TURNOVER_IMPORT_HEADERS].filter(pred);
}

function isStockoutGroupHeader(header: string): boolean {
  return header.includes('断货') || header.includes('上架时间') || header.includes('最早上架');
}

const REPLENISH_SHEET_HEADERS = [
  ...MASTER_DATA_COLS,
  '海外仓库存_合计',
  '调拨在途_合计',
  '供应商订单合计',
  '预下单',
  '全链条合计库存',
  '3天销量',
  '7天销量',
  '30天销量',
  '海外周转_合计',
];

const WAREHOUSE_SHEET_HEADERS = [
  ...MASTER_DATA_COLS,
  ...sheetHeadersMatching(
    (h) =>
      h.startsWith('海外仓库存_') ||
      h.startsWith('调拨在途_') ||
      h.startsWith('已调拨未在途_'),
  ),
];

const STOCKOUT_SHEET_HEADERS = [
  ...MASTER_DATA_COLS,
  ...sheetHeadersMatching(isStockoutGroupHeader),
];

function uniqueValidColumnIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!VALID_COLUMN_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : ['SKU'];
}

export function getViewColumnIds(viewId: OverviewViewId): string[] {
  let sheetHeaders: string[];
  switch (viewId) {
    case 'warehouse':
      sheetHeaders = WAREHOUSE_SHEET_HEADERS;
      break;
    case 'stockout':
      sheetHeaders = STOCKOUT_SHEET_HEADERS;
      break;
    case 'excel_full':
      sheetHeaders = [...TURNOVER_IMPORT_HEADERS];
      break;
    case 'custom':
      return getViewColumnIds('replenish');
    case 'replenish':
    default:
      sheetHeaders = REPLENISH_SHEET_HEADERS;
      break;
  }

  const trailingOps = ['replenishLight', 'ai'];
  const trailingMeta =
    viewId === 'replenish'
      ? ['inventoryRecordedDate']
      : ['updatedAt', 'dataSource', 'inventoryRecordedDate'];
  return orderOverviewColumnIds(uniqueValidColumnIds([...sheetHeaders, ...trailingOps, ...trailingMeta]));
}

export function getDefaultOverviewViewId(): OverviewViewId {
  return 'replenish';
}

export function resolveOverviewColumnIds(options?: {
  view?: string;
  columns?: string[];
}): string[] | undefined {
  if (options?.columns?.length) {
    return uniqueValidColumnIds(options.columns);
  }
  const view = options?.view as OverviewViewId | undefined;
  if (view && view !== 'custom') {
    return getViewColumnIds(view);
  }
  return undefined;
}

export function getDefaultVisibleColumnIds(): string[] {
  return getViewColumnIds('replenish');
}

export function projectTurnoverExtras(
  snapshot: Record<string, string>,
  columnIds?: string[],
): Record<string, string> {
  if (!columnIds?.length) return snapshot;
  const allowed = new Set(columnIds);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}
