import { TURNOVER_IMPORT_HEADERS } from './inventory-turnover-headers';
import type { OverviewColumnDef } from './inventory-overview-columns';
import { orderOverviewColumnIds } from './inventory-overview-column-order';

export type OverviewViewId = 'replenish' | 'warehouse' | 'stockout' | 'excel_full' | 'custom';

export const OVERVIEW_VIEW_STORAGE_KEY = 'scm.inventory-overview.view-v1';
export const CUSTOM_COLUMNS_STORAGE_KEY = 'scm.inventory-overview.visible-columns-v4';

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
  return TURNOVER_IMPORT_HEADERS.filter(pred);
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

const EXCEL_FULL_SHEET_HEADERS = [...TURNOVER_IMPORT_HEADERS];

export const OVERVIEW_VIEW_OPTIONS: Array<{ id: OverviewViewId; label: string }> = [
  { id: 'replenish', label: '补货日常' },
  { id: 'warehouse', label: '分仓库存' },
  { id: 'stockout', label: '断货与上架' },
  { id: 'excel_full', label: 'Excel 全字段' },
  { id: 'custom', label: '自定义' },
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

export function getViewColumnIds(viewId: OverviewViewId, customColumnIds?: string[]): string[] {
  if (viewId === 'custom') {
    return uniqueValidColumnIds(customColumnIds ?? []);
  }

  let sheetHeaders: string[];
  switch (viewId) {
    case 'warehouse':
      sheetHeaders = WAREHOUSE_SHEET_HEADERS;
      break;
    case 'stockout':
      sheetHeaders = STOCKOUT_SHEET_HEADERS;
      break;
    case 'excel_full':
      sheetHeaders = EXCEL_FULL_SHEET_HEADERS;
      break;
    case 'replenish':
    default:
      sheetHeaders = REPLENISH_SHEET_HEADERS;
      break;
  }

  const trailingOps: string[] = ['replenishLight', 'ai'];
  const trailingMeta =
    viewId === 'replenish'
      ? ['inventoryRecordedDate']
      : ['updatedAt', 'dataSource', 'inventoryRecordedDate'];

  return orderOverviewColumnIds(uniqueValidColumnIds([...sheetHeaders, ...trailingOps, ...trailingMeta]));
}

export function getDefaultOverviewViewId(): OverviewViewId {
  return 'replenish';
}

export function loadOverviewViewId(): OverviewViewId {
  try {
    const raw = localStorage.getItem(OVERVIEW_VIEW_STORAGE_KEY);
    if (raw && OVERVIEW_VIEW_OPTIONS.some((v) => v.id === raw)) {
      return raw as OverviewViewId;
    }
  } catch {
    /* ignore */
  }
  return getDefaultOverviewViewId();
}

export function saveOverviewViewId(viewId: OverviewViewId): void {
  localStorage.setItem(OVERVIEW_VIEW_STORAGE_KEY, viewId);
}

export function loadCustomColumnIds(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COLUMNS_STORAGE_KEY);
    if (!raw) return getViewColumnIds('replenish');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return getViewColumnIds('replenish');
    return orderOverviewColumnIds(
      uniqueValidColumnIds(parsed.filter((id): id is string => typeof id === 'string')),
    );
  } catch {
    return getViewColumnIds('replenish');
  }
}

export function saveCustomColumnIds(ids: string[]): void {
  localStorage.setItem(
    CUSTOM_COLUMNS_STORAGE_KEY,
    JSON.stringify(orderOverviewColumnIds(uniqueValidColumnIds(ids))),
  );
}

/** 根据当前视图解析实际应展示的列 */
export function resolveAppliedColumnIds(
  viewId: OverviewViewId,
  customColumnIds: string[],
): string[] {
  if (viewId === 'custom') {
    return orderOverviewColumnIds(customColumnIds);
  }
  return getViewColumnIds(viewId);
}

export function loadInitialViewState(): {
  viewId: OverviewViewId;
  customColumnIds: string[];
} {
  const viewId = loadOverviewViewId();
  const customColumnIds = loadCustomColumnIds();
  return { viewId, customColumnIds };
}

export function columnsByGroup(catalog: OverviewColumnDef[]): Map<string, OverviewColumnDef[]> {
  const groups = new Map<string, OverviewColumnDef[]>();
  for (const col of catalog) {
    const list = groups.get(col.group) ?? [];
    list.push(col);
    groups.set(col.group, list);
  }
  return groups;
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

/** 抽屉 Tab 分组顺序 */
export const DRAWER_TAB_GROUPS = [
  '更新信息',
  '主数据扩展',
  '销售占比',
  '海外仓库存',
  '预计上架',
  '调拨在途',
  '供应商订单',
  '已调拨未在途',
  '库存汇总',
  '销量',
  '预测日均',
  '周转天数',
  '断货与上架',
  '包装与毛利',
  '运营',
  '其他',
] as const;

export function groupCatalogForDrawer(catalog: OverviewColumnDef[]): Map<string, OverviewColumnDef[]> {
  const map = new Map<string, OverviewColumnDef[]>();
  for (const group of DRAWER_TAB_GROUPS) {
    map.set(group, []);
  }
  for (const col of catalog) {
    const bucket = map.has(col.group) ? col.group : '其他';
    const list = map.get(bucket) ?? [];
    list.push(col);
    map.set(bucket, list);
  }
  return map;
}
