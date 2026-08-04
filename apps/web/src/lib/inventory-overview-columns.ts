import { FEISHU_INVENTORY_TURNOVER_HEADERS } from './inventory-turnover-feishu-headers';
import { inferOverviewColumnGroup } from './inventory-overview-groups';
import { getViewColumnIds } from './inventory-overview-views';

export type OverviewColumnDef = {
  id: string;
  label: string;
  group: string;
  kind: 'meta' | 'sheet' | 'ops';
  excelCol?: string;
  defaultVisible: boolean;
};

const META_COLUMNS: OverviewColumnDef[] = [
  { id: 'updatedAt', label: '更新时间', group: '主数据', kind: 'meta', defaultVisible: true },
  { id: 'dataSource', label: '数据来源', group: '主数据', kind: 'meta', defaultVisible: true },
  {
    id: 'inventoryRecordedDate',
    label: '库存快照日期',
    group: '主数据',
    kind: 'meta',
    defaultVisible: false,
  },
];

const SHEET_COLUMNS: OverviewColumnDef[] = FEISHU_INVENTORY_TURNOVER_HEADERS.map((header, index) => ({
  id: header,
  label: header,
  group: inferOverviewColumnGroup(header),
  kind: 'sheet' as const,
  excelCol: `F${index + 1}`,
  defaultVisible: false,
}));

const OPS_COLUMNS: OverviewColumnDef[] = [
  { id: 'replenishLight', label: '补货灯', group: '主数据', kind: 'ops', defaultVisible: true },
  { id: 'ai', label: 'AI', group: '主数据', kind: 'ops', defaultVisible: true },
];

export const INVENTORY_OVERVIEW_COLUMNS: OverviewColumnDef[] = [
  ...META_COLUMNS,
  ...SHEET_COLUMNS,
  ...OPS_COLUMNS,
];

export const TURNOVER_SHEET_COLUMN_COUNT = FEISHU_INVENTORY_TURNOVER_HEADERS.length;

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

export function formatOverviewDataSource(source: string | null | undefined): string {
  if (!source) return '-';
  return DATA_SOURCE_LABEL[source] ?? source;
}

export function formatOverviewUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function mergeColumnCatalog(
  serverColumns?: OverviewColumnDef[],
): OverviewColumnDef[] {
  if (!serverColumns?.length) return INVENTORY_OVERVIEW_COLUMNS;
  const byId = new Map(INVENTORY_OVERVIEW_COLUMNS.map((c) => [c.id, c]));
  for (const col of serverColumns) {
    byId.set(col.id, col);
  }
  return Array.from(byId.values());
}
