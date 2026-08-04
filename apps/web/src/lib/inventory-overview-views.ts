import {
  FEISHU_INVENTORY_TURNOVER_HEADERS,
  FEISHU_REPLENISH_VIEW_HEADERS,
  FEISHU_STOCKOUT_VIEW_HEADERS,
  FEISHU_WAREHOUSE_VIEW_HEADERS,
} from './inventory-turnover-feishu-headers';
import type { OverviewColumnDef } from './inventory-overview-columns';
import { orderOverviewColumnIds } from './inventory-overview-column-order';
import { OVERVIEW_COLUMN_GROUPS } from './inventory-overview-groups';


export type OverviewViewId = 'replenish' | 'warehouse' | 'stockout' | 'feishu_full' | 'excel_full' | 'custom';

export const OVERVIEW_VIEW_STORAGE_KEY = 'scm.inventory-overview.view-v2';
export const CUSTOM_COLUMNS_STORAGE_KEY = 'scm.inventory-overview.visible-columns-v5';

const VALID_COLUMN_IDS = new Set([
  'updatedAt',
  'dataSource',
  'inventoryRecordedDate',
  'replenishLight',
  'ai',
  ...FEISHU_INVENTORY_TURNOVER_HEADERS,
]);

export const OVERVIEW_VIEW_OPTIONS: Array<{ id: OverviewViewId; label: string }> = [
  { id: 'replenish', label: '补货日常' },
  { id: 'warehouse', label: '近半年海外仓销售占比' },
  { id: 'stockout', label: '断货与上架' },
  { id: 'feishu_full', label: '飞书全字段' },
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

  let sheetHeaders: readonly string[];
  switch (viewId) {
    case 'warehouse':
      sheetHeaders = FEISHU_WAREHOUSE_VIEW_HEADERS;
      break;
    case 'stockout':
      sheetHeaders = FEISHU_STOCKOUT_VIEW_HEADERS;
      break;
    case 'feishu_full':
    case 'excel_full':
      sheetHeaders = FEISHU_INVENTORY_TURNOVER_HEADERS;
      break;
    case 'replenish':
    default:
      sheetHeaders = FEISHU_REPLENISH_VIEW_HEADERS;
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
    if (raw === 'excel_full') return 'feishu_full';
    if (raw && OVERVIEW_VIEW_OPTIONS.some((v) => v.id === raw)) {
      return raw as OverviewViewId;
    }
  } catch {
    /* ignore */
  }
  return getDefaultOverviewViewId();
}

export function saveOverviewViewId(viewId: OverviewViewId): void {
  const normalized = viewId === 'excel_full' ? 'feishu_full' : viewId;
  localStorage.setItem(OVERVIEW_VIEW_STORAGE_KEY, normalized);
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

/** 抽屉 Tab 分组顺序（与列选择器一致） */
export const DRAWER_TAB_GROUPS = OVERVIEW_COLUMN_GROUPS;

export function groupCatalogForDrawer(catalog: OverviewColumnDef[]): Map<string, OverviewColumnDef[]> {
  const map = new Map<string, OverviewColumnDef[]>();
  for (const group of DRAWER_TAB_GROUPS) {
    map.set(group, []);
  }
  for (const col of catalog) {
    const bucket = map.has(col.group) ? col.group : '主数据';
    const list = map.get(bucket) ?? [];
    list.push(col);
    map.set(bucket, list);
  }
  return map;
}
