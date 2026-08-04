import {
  FEISHU_INVENTORY_TURNOVER_HEADERS,
  FEISHU_REPLENISH_VIEW_HEADERS,
  FEISHU_STOCKOUT_VIEW_HEADERS,
  FEISHU_WAREHOUSE_VIEW_HEADERS,
} from './inventory-turnover-feishu-headers.js';
import { orderOverviewColumnIds } from './inventory-overview-column-order.js';

export type OverviewViewId = 'replenish' | 'warehouse' | 'stockout' | 'feishu_full' | 'excel_full' | 'custom';

const VALID_COLUMN_IDS = new Set([
  'updatedAt',
  'dataSource',
  'inventoryRecordedDate',
  'replenishLight',
  'ai',
  ...FEISHU_INVENTORY_TURNOVER_HEADERS,
]);

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
    case 'custom':
      return getViewColumnIds('replenish');
    case 'replenish':
    default:
      sheetHeaders = FEISHU_REPLENISH_VIEW_HEADERS;
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
