import {
  getPublishedProcurementOpsSnapshotDate,
  listProcurementOpsSnapshotDates,
  loadProcurementOpsSnapshots,
} from './procurement-ops-snapshot.js';
import { defaultVisibleProcurementOpsColumns } from './procurement-ops-feishu-mapper.js';
import {
  PROCUREMENT_OPS_DEFAULT_VISIBLE_HEADERS,
  PROCUREMENT_OPS_HEADERS,
} from './procurement-ops-headers.js';
import { matchesProductScope, type ProductScope } from './planning-accessory-filter.js';

export type ProcurementOpsListItem = {
  skuId: string | null;
  skuCode: string;
  payload: Record<string, string>;
};

export type ProcurementOpsListFilters = {
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
};

function payloadIncludes(
  payload: Record<string, string>,
  key: string,
  expected?: string,
): boolean {
  if (!expected) return true;
  const value = payload[key] ?? '';
  return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
}

export function filterProcurementOpsItems(
  items: ProcurementOpsListItem[],
  filters: ProcurementOpsListFilters,
): ProcurementOpsListItem[] {
  return items.filter((item) => {
    const q = filters.q?.trim();
    if (q) {
      const hay = `${item.skuCode}\n${item.payload.SKU名称 ?? ''}\n${item.payload.SKU ?? ''}`;
      if (!hay.toLocaleLowerCase().includes(q.toLocaleLowerCase())) return false;
    }
    const scope = filters.productScope ?? 'goods';
    if (!matchesProductScope(scope, { code: item.skuCode })) return false;
    return (
      payloadIncludes(item.payload, '品类', filters.category) &&
      payloadIncludes(item.payload, '销售国家', filters.salesCountry) &&
      payloadIncludes(item.payload, '生命周期', filters.lifecycle)
    );
  });
}

function resolveColumns(stored: string[], items: ProcurementOpsListItem[]): string[] {
  if (stored.length) return stored;
  const fromItems = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.payload)) fromItems.add(key);
  }
  if (fromItems.size) return Array.from(fromItems);
  return [...PROCUREMENT_OPS_HEADERS];
}

export async function listProcurementOpsRows(input: {
  page: number;
  pageSize: number;
  offset: number;
  snapshotDate?: string;
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
}) {
  const meta = await getPublishedProcurementOpsSnapshotDate(input.snapshotDate);
  if (!meta.selectedSnapshotDate) {
    return {
      items: [] as ProcurementOpsListItem[],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      selectedSnapshotDate: null as string | null,
      latestSnapshotDate: meta.latestSnapshotDate,
      isLatestSnapshot: false,
      isStale: false,
      syncedAt: null as string | null,
      columns: [...PROCUREMENT_OPS_HEADERS],
      defaultVisibleColumns: [...PROCUREMENT_OPS_DEFAULT_VISIBLE_HEADERS],
    };
  }

  const loaded = await loadProcurementOpsSnapshots({
    snapshotDate: meta.selectedSnapshotDate,
  });
  const filtered = filterProcurementOpsItems(
    loaded.map((row) => ({
      skuId: row.skuId,
      skuCode: row.skuCode,
      payload: row.payload,
    })),
    {
      q: input.q,
      category: input.category,
      salesCountry: input.salesCountry,
      lifecycle: input.lifecycle,
      productScope: input.productScope,
    },
  );

  const total = filtered.length;
  const items = filtered.slice(input.offset, input.offset + input.pageSize);
  const columns = resolveColumns(meta.columns, filtered);
  const defaultVisibleColumns = defaultVisibleProcurementOpsColumns(columns);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    selectedSnapshotDate: meta.selectedSnapshotDate,
    latestSnapshotDate: meta.latestSnapshotDate,
    isLatestSnapshot: meta.isLatestSnapshot,
    isStale: meta.isStale,
    syncedAt: meta.syncedAt,
    columns,
    defaultVisibleColumns,
  };
}

export async function buildProcurementOpsExportRows(input: {
  snapshotDate?: string;
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
  columns?: string[];
}) {
  const result = await listProcurementOpsRows({
    page: 1,
    pageSize: 100_000,
    offset: 0,
    ...input,
  });
  const columnIds = input.columns?.length ? input.columns : result.columns;
  const headers = columnIds;
  const rows = result.items.map((item) =>
    columnIds.map((col) => item.payload[col] ?? (col === 'SKU' ? item.skuCode : '')),
  );
  return {
    headers,
    rows,
    selectedSnapshotDate: result.selectedSnapshotDate,
    syncedAt: result.syncedAt,
  };
}

export { listProcurementOpsSnapshotDates };
